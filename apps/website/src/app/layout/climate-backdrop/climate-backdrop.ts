import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { ClimateService } from '@core/services/climate.service';

/**
 * One global seasonal canvas shared by every page.
 * Season is expressed only through restrained ambient colour and a slow light
 * shift; individual pages do not render their own weather or seasonal scenery.
 */
@Component({
  selector: 'app-climate-backdrop',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'aria-hidden': 'true',
    '[class.bd--active]': 'active()',
    '[class.bd--radiant]': 'sceneClass() === "radiant"',
    '[class.bd--frost]': 'sceneClass() === "frost"',
    '[class.bd--temperate]': 'sceneClass() === "temperate"',
    '[class.bd--preview]': 'previewing()',
  },
  template: `
    <div class="bd__wash bd__wash--summer"></div>
    <div class="bd__wash bd__wash--winter"></div>
    <div class="bd__wash bd__wash--all"></div>
    <div class="bd__field"></div>
    <div class="bd__flare"></div>
    <div class="bd__grain"></div>
  `,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      z-index: 0;
      display: block;
      overflow: hidden;
      pointer-events: none;
      background: var(--canvas-neutral);
      isolation: isolate;
    }

    .bd__wash,
    .bd__field,
    .bd__flare,
    .bd__grain {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }

    .bd__wash {
      inset: -8%;
      opacity: 0;
      transform: scale(1.02);
      transition: opacity 900ms var(--ease-climate);
    }

    .bd__wash--summer {
      background:
        radial-gradient(circle at 84% 6%, rgba(207, 118, 45, 0.5), transparent 43%),
        radial-gradient(circle at 8% 92%, rgba(166, 91, 41, 0.22), transparent 38%),
        linear-gradient(140deg, #fff8ef 4%, #f1d3b8 50%, #dca46f 100%);
    }

    .bd__wash--winter {
      background:
        radial-gradient(circle at 12% 6%, rgba(65, 128, 168, 0.48), transparent 44%),
        radial-gradient(circle at 92% 88%, rgba(66, 105, 133, 0.22), transparent 40%),
        linear-gradient(145deg, #f8fcff 2%, #cbdfea 50%, #8fb7cf 100%);
    }

    .bd__wash--all {
      background:
        radial-gradient(circle at 83% 13%, rgba(207, 118, 45, 0.38), transparent 39%),
        radial-gradient(circle at 13% 86%, rgba(65, 128, 168, 0.42), transparent 42%),
        conic-gradient(
          from 214deg at 52% 48%,
          transparent 0 25%,
          rgba(219, 139, 70, 0.14) 31%,
          transparent 38% 61%,
          rgba(101, 164, 200, 0.16) 68%,
          transparent 76%
        ),
        linear-gradient(142deg, #f8fbfd 0%, #e7e2dc 48%, #d7e3e8 100%);
    }

    .bd__wash--all::before,
    .bd__wash--all::after {
      content: '';
      position: absolute;
      inset: -20%;
      border-radius: 50%;
      filter: blur(34px);
      mix-blend-mode: soft-light;
      opacity: 0.55;
    }

    .bd__wash--all::before {
      background: radial-gradient(ellipse 40% 55% at 66% 38%, #dc884b 0%, transparent 72%);
      animation: bd-all-warm-drift 17s var(--ease-climate) infinite alternate;
    }

    .bd__wash--all::after {
      background: radial-gradient(ellipse 44% 58% at 34% 62%, #6baccd 0%, transparent 72%);
      animation: bd-all-cool-drift 19s var(--ease-climate) infinite alternate;
    }

    .bd__field {
      inset: -24%;
      opacity: 0;
      background: radial-gradient(
        ellipse at 72% 22%,
        color-mix(in srgb, var(--clime-key) 32%, transparent),
        transparent 48%
      );
      filter: blur(18px);
      transform: translate3d(-2%, -1%, 0);
      transition:
        opacity var(--dur-atmosphere) var(--ease-climate),
        background var(--dur-atmosphere) var(--ease-climate);
    }

    .bd__grain {
      opacity: 0.02;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.7'/%3E%3C/svg%3E");
      mix-blend-mode: multiply;
    }

    :host.bd--radiant .bd__wash--summer,
    :host.bd--frost .bd__wash--winter,
    :host.bd--temperate .bd__wash--all {
      opacity: 1;
    }

    :host.bd--active .bd__field {
      opacity: 0.88;
      animation: bd-field-drift 16s var(--ease-climate) infinite alternate;
    }

    .bd__flare {
      inset: -28%;
      opacity: 0;
      background:
        radial-gradient(
          circle at 72% 34%,
          color-mix(in srgb, var(--clime-key) 48%, #fff 8%),
          color-mix(in srgb, var(--clime-key) 15%, transparent) 28%,
          transparent 58%
        ),
        linear-gradient(
          108deg,
          transparent 28%,
          color-mix(in srgb, var(--clime-key) 14%, transparent) 50%,
          transparent 72%
        );
      filter: blur(22px);
      mix-blend-mode: screen;
      transform: scale(0.76) translate3d(-8%, 2%, 0);
    }

    :host.bd--temperate .bd__flare {
      background:
        radial-gradient(
          ellipse 44% 62% at 74% 32%,
          rgba(218, 132, 66, 0.4),
          rgba(218, 132, 66, 0.1) 38%,
          transparent 68%
        ),
        radial-gradient(
          ellipse 46% 64% at 30% 70%,
          rgba(91, 159, 196, 0.42),
          rgba(91, 159, 196, 0.1) 40%,
          transparent 70%
        ),
        conic-gradient(
          from 225deg at 52% 50%,
          transparent 0 28%,
          rgba(226, 143, 76, 0.11) 34%,
          transparent 41% 60%,
          rgba(105, 176, 211, 0.12) 67%,
          transparent 75%
        );
    }

    :host.bd--preview .bd__flare {
      animation: bd-preview-flare 5s cubic-bezier(0.22, 1, 0.36, 1) both;
    }

    @keyframes bd-field-drift {
      from {
        transform: translate3d(-2%, -1%, 0);
      }
      to {
        transform: translate3d(3%, 2%, 0);
      }
    }

    @keyframes bd-all-warm-drift {
      from {
        transform: translate3d(4%, -3%, 0) rotate(-5deg) scale(0.92);
      }
      to {
        transform: translate3d(-7%, 5%, 0) rotate(7deg) scale(1.08);
      }
    }

    @keyframes bd-all-cool-drift {
      from {
        transform: translate3d(-4%, 5%, 0) rotate(6deg) scale(1.06);
      }
      to {
        transform: translate3d(8%, -4%, 0) rotate(-8deg) scale(0.94);
      }
    }

    @keyframes bd-preview-flare {
      0% {
        opacity: 0;
        transform: scale(0.76) translate3d(-8%, 2%, 0);
      }
      14% {
        opacity: 0.62;
      }
      48% {
        opacity: 0.4;
        transform: scale(1.02) translate3d(0, 0, 0);
      }
      100% {
        opacity: 0;
        transform: scale(1.2) translate3d(6%, -2%, 0);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .bd__wash,
      .bd__field {
        transition: none;
      }

      :host.bd--active .bd__field {
        animation: none;
      }

      .bd__wash--all::before,
      .bd__wash--all::after {
        animation: none;
      }

      :host.bd--preview .bd__flare {
        animation: none;
      }
    }
  `,
})
export class ClimateBackdrop {
  private readonly climate = inject(ClimateService);

  protected readonly active = this.climate.hasSeason;
  protected readonly previewing = this.climate.previewing;
  protected readonly sceneClass = computed(() =>
    this.climate.hasSeason() ? this.climate.animationProfile() : null,
  );
}
