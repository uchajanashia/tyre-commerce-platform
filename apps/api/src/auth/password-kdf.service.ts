import { randomBytes } from 'node:crypto';

import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import * as bcrypt from 'bcrypt';

const ARGON_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  version: 0x13,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
};

export type PasswordVerification = { valid: boolean; needsRehash: boolean; legacyBcrypt: boolean };

export function validatePasswordInput(password: string): void {
  const codePoints = [...password].length;
  const bytes = Buffer.byteLength(password, 'utf8');
  if (codePoints < 12) throw new Error('PASSWORD_TOO_SHORT');
  if (codePoints > 256 || bytes > 1024) throw new Error('PASSWORD_TOO_LONG');
}

class KdfQueue {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  async run<T>(job: () => Promise<T>): Promise<T> {
    if (this.active >= 4) {
      if (this.waiters.length >= 32) throw new HttpException({ code: 'RATE_LIMITED' }, HttpStatus.TOO_MANY_REQUESTS);
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;
    try {
      return await job();
    } finally {
      this.active -= 1;
      this.waiters.shift()?.();
    }
  }
}

@Injectable()
export class PasswordKdfService {
  private readonly queue = new KdfQueue();
  private readonly dummyHashPromise = argon2.hash('dummy-password-never-authenticates', { ...ARGON_OPTIONS, salt: randomBytes(16) });

  hash(password: string): Promise<string> {
    validatePasswordInput(password);
    return this.queue.run(() => argon2.hash(password, { ...ARGON_OPTIONS, salt: randomBytes(16) }));
  }

  async verify(storedHash: string | null | undefined, password: string): Promise<PasswordVerification> {
    if ([...password].length > 256 || Buffer.byteLength(password, 'utf8') > 1024) {
      await this.verifyDummy('bounded-input');
      return { valid: false, needsRehash: false, legacyBcrypt: false };
    }
    if (!storedHash) {
      await this.verifyDummy(password);
      return { valid: false, needsRehash: false, legacyBcrypt: false };
    }
    if (storedHash.startsWith('$argon2id$')) {
      const valid = await this.queue.run(() => argon2.verify(storedHash, password));
      return { valid, needsRehash: valid && argon2.needsRehash(storedHash, ARGON_OPTIONS), legacyBcrypt: false };
    }
    if (/^\$2[aby]\$/.test(storedHash)) {
      const valid = await this.queue.run(() => bcrypt.compare(password, storedHash));
      return { valid, needsRehash: valid, legacyBcrypt: true };
    }
    await this.verifyDummy(password);
    return { valid: false, needsRehash: false, legacyBcrypt: false };
  }

  private async verifyDummy(password: string): Promise<void> {
    const dummy = await this.dummyHashPromise;
    await this.queue.run(async () => {
      await argon2.verify(dummy, password);
    });
  }
}

export const ARGON2_POLICY = Object.freeze({
  algorithm: 'argon2id',
  version: 19,
  memoryCostKiB: 65_536,
  timeCost: 3,
  parallelism: 1,
  saltBytes: 16,
  hashBytes: 32,
  maxConcurrent: 4,
  maxQueue: 32,
});
