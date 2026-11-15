import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import compression from 'compression';
import express from 'express';
import { join } from 'node:path';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

app.disable('x-powered-by');
app.set('trust proxy', 1);

// Process liveness must not SSR a page or depend on the catalog API.
app.get('/health/live', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Gzip responses (JS/CSS/HTML/SVG) — required to stay inside the transfer
// budgets of 08-non-functional.md; production CDNs would do this otherwise.
app.use(compression());

/**
 * Example Express Rest API endpoints can be defined here.
 * Uncomment and define endpoints as necessary.
 *
 * Example:
 * ```ts
 * app.get('/api/{*splat}', (req, res) => {
 *   // Handle API request
 * });
 * ```
 */

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    // Copied public assets (robots, sitemap, hero media) are not content-hashed;
    // only Angular's hashed bundles are immutable.
    maxAge: '1h',
    index: false,
    redirect: false,
    setHeaders: (response, filePath) => {
      const normalized = filePath.replaceAll('\\', '/');
      if (/\/[a-z0-9._-]+-[A-Z0-9]{8,}\.(?:css|js)$/i.test(normalized)) {
        response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else if (normalized.endsWith('/sitemap.xml') || normalized.endsWith('/robots.txt')) {
        response.setHeader('Cache-Control', 'public, max-age=300');
      }
    },
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on port ${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
