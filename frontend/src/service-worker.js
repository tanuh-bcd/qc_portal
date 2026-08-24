/* eslint-disable no-restricted-globals */
import { clientsClaim } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { StaleWhileRevalidate, NetworkFirst } from 'workbox-strategies';

self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);

const fileExtensionRegexp = new RegExp('/[^/?]+\\.[^/]+$');
registerRoute(
  ({ request, url }) => {
    if (request.mode !== 'navigate') return false;
    if (url.pathname.startsWith('/_')) return false;
    if (url.pathname.match(fileExtensionRegexp)) return false;
    return true;
  },
  createHandlerBoundToURL(process.env.PUBLIC_URL + '/index.html')
);

registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/static/'),
  new StaleWhileRevalidate({
    cacheName: 'static-assets',
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 })],
  })
);

registerRoute(
  ({ url }) =>
    url.origin === self.location.origin &&
    (url.pathname.endsWith('.png') || url.pathname.endsWith('.svg') || url.pathname.endsWith('.jpg')),
  new StaleWhileRevalidate({
    cacheName: 'images',
    plugins: [new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 30 * 24 * 60 * 60 })],
  })
);

registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/api/'),
  new NetworkFirst({
    cacheName: 'api-cache',
    plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 5 * 60 })],
  })
);

registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
  new StaleWhileRevalidate({ cacheName: 'google-fonts', plugins: [new ExpirationPlugin({ maxEntries: 10 })] })
);

