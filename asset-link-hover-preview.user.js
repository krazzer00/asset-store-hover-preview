// ==UserScript==
// @name         Asset Store Hover Preview
// @name:ru      Предпросмотр ассетов по наведению
// @namespace    https://github.com/krazzer00/asset-store-hover-preview
// @version      1.1.0
// @description  Shows product images and details when hovering links to Jinxxy, Gumroad, Payhip and other stores.
// @description:ru Показывает изображения и данные товара при наведении на ссылки Jinxxy, Gumroad, Payhip и других магазинов.
// @homepageURL  https://github.com/krazzer00/asset-store-hover-preview
// @supportURL   https://github.com/krazzer00/asset-store-hover-preview/issues
// @downloadURL  https://raw.githubusercontent.com/krazzer00/asset-store-hover-preview/main/asset-link-hover-preview.user.js
// @updateURL    https://raw.githubusercontent.com/krazzer00/asset-store-hover-preview/main/asset-link-hover-preview.user.js
// @match        https://forum.ripper.store/*
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-idle
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  const CONFIG = {
    hoverDelayMs: 380,
    requestTimeoutMs: 15000,
    maxImages: 4,
    maxDescriptionLength: 190,
    previewAllExternalLinks: true,
    prefetchEnabled: true,
    prefetchStartDelayMs: 900,
    prefetchConcurrency: 3,
    prefetchGapMs: 120,
    maxPrefetchLinks: 250,
  };

  const STORE_HOSTS = [
    /(^|\.)jinxxy\.com$/i,
    /(^|\.)gumroad\.com$/i,
    /(^|\.)payhip\.com$/i,
    /(^|\.)booth\.pm$/i,
    /(^|\.)ko-fi\.com$/i,
    /(^|\.)itch\.io$/i,
    /(^|\.)sellfy\.com$/i,
    /(^|\.)fourthwall\.com$/i,
    /(^|\.)vrmodels\.store$/i,
  ];

  const SKIP_HOSTS = [
    /(^|\.)discord\.(com|gg)$/i,
    /(^|\.)drive\.google\.com$/i,
    /(^|\.)dropbox\.com$/i,
    /(^|\.)gofile\.io$/i,
    /(^|\.)mega\.nz$/i,
    /(^|\.)mediafire\.com$/i,
    /(^|\.)pixeldrain\.com$/i,
    /(^|\.)youtube\.com$/i,
    /(^|\.)youtu\.be$/i,
    /(^|\.)twitter\.com$/i,
    /(^|\.)x\.com$/i,
    /(^|\.)tiktok\.com$/i,
  ];

  const DIRECT_IMAGE_RE = /\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i;
  const DOWNLOAD_LINK_TEXT_RE = /^(?:dl|download|скачать)$/i;
  const cache = new Map();
  const prefetchQueue = [];
  const queuedUrls = new Set();
  const prefetchAttempted = new Set();
  let hoverTimer = 0;
  let activeAnchor = null;
  let prefetchActive = 0;
  let mouseX = 0;
  let mouseY = 0;

  const host = document.createElement('div');
  host.id = 'asset-hover-preview-host';
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  document.documentElement.append(host);

  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .card {
        --bg: rgba(17, 19, 24, .97);
        position: fixed;
        display: none;
        width: min(420px, calc(100vw - 24px));
        max-height: min(600px, calc(100vh - 24px));
        overflow: hidden;
        color: #f4f5f7;
        background: var(--bg);
        border: 1px solid rgba(255,255,255,.13);
        border-radius: 14px;
        box-shadow: 0 16px 48px rgba(0,0,0,.48);
        font: 13px/1.42 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        opacity: 0;
        transform: translateY(4px) scale(.985);
        transition: opacity 110ms ease, transform 110ms ease;
        backdrop-filter: blur(14px);
      }
      .card.visible { display: block; opacity: 1; transform: none; }
      .media {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 2px;
        max-height: 410px;
        background: #090a0d;
        overflow: hidden;
      }
      .media.single { display: block; }
      .media img {
        display: block;
        width: 100%;
        height: 198px;
        object-fit: cover;
        background: #0b0c0f;
      }
      .media.single img { height: auto; max-height: 410px; object-fit: contain; }
      .body { padding: 12px 14px 14px; }
      .domain {
        overflow: hidden;
        margin-bottom: 4px;
        color: #9da3af;
        font-size: 11px;
        letter-spacing: .04em;
        text-overflow: ellipsis;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .title {
        overflow: hidden;
        font-size: 15px;
        font-weight: 700;
        line-height: 1.3;
        text-overflow: ellipsis;
      }
      .meta { display: flex; gap: 8px; align-items: baseline; margin-top: 7px; }
      .price { color: #7ee2a8; font-size: 14px; font-weight: 700; }
      .description {
        display: -webkit-box;
        overflow: hidden;
        margin-top: 7px;
        color: #c2c6ce;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
      }
      .loading {
        display: flex;
        min-height: 94px;
        align-items: center;
        gap: 11px;
        padding: 0 16px;
        color: #c2c6ce;
      }
      .spinner {
        width: 17px;
        height: 17px;
        flex: 0 0 auto;
        border: 2px solid rgba(255,255,255,.2);
        border-top-color: #8eb8ff;
        border-radius: 50%;
        animation: spin .65s linear infinite;
      }
      .error { padding: 15px 16px; color: #d1d4db; }
      .error strong { display: block; margin-bottom: 4px; color: #ffb4ab; font-size: 14px; }
      .hint { margin-top: 6px; color: #8f96a3; font-size: 11px; }
      @keyframes spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) {
        .card { transition: none; }
        .spinner { animation-duration: 1.4s; }
      }
    </style>
    <section class="card" role="tooltip" aria-live="polite"></section>
  `;
  const card = shadow.querySelector('.card');

  function normalizeUrl(value, base = location.href) {
    try {
      const url = new URL(value, base);
      if (!/^https?:$/.test(url.protocol)) return null;
      url.hash = '';
      return url.href;
    } catch {
      return null;
    }
  }

  function isPreviewable(anchor) {
    if (!anchor || anchor.closest('#asset-hover-preview-host')) return false;
    if (anchor.hasAttribute('download') || DOWNLOAD_LINK_TEXT_RE.test(text(anchor.textContent))) return false;
    const href = normalizeUrl(anchor.href);
    if (!href) return false;
    const url = new URL(href);
    if (url.hostname === location.hostname) return false;
    if (SKIP_HOSTS.some((pattern) => pattern.test(url.hostname))) return false;
    return CONFIG.previewAllExternalLinks
      || DIRECT_IMAGE_RE.test(url.pathname)
      || STORE_HOSTS.some((pattern) => pattern.test(url.hostname));
  }

  function text(value) {
    const decoder = document.createElement('textarea');
    decoder.innerHTML = String(value || '');
    return decoder.value.replace(/\s+/g, ' ').trim();
  }

  function truncate(value, length) {
    const cleaned = text(value);
    return cleaned.length > length ? `${cleaned.slice(0, length - 1).trim()}…` : cleaned;
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function metaContent(doc, selectors) {
    for (const selector of selectors) {
      const value = doc.querySelector(selector)?.getAttribute('content');
      if (text(value)) return text(value);
    }
    return '';
  }

  function walkJson(value, visitor, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    visitor(value);
    if (Array.isArray(value)) {
      value.forEach((item) => walkJson(item, visitor, seen));
    } else {
      Object.values(value).forEach((item) => walkJson(item, visitor, seen));
    }
  }

  function jsonLdProducts(doc) {
    const products = [];
    for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(script.textContent);
        walkJson(data, (item) => {
          const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
          if (types.some((type) => String(type).toLowerCase() === 'product')) products.push(item);
        });
      } catch {
        // Some storefronts contain malformed optional JSON-LD. Other metadata still works.
      }
    }
    return products;
  }

  function imageValues(value) {
    if (!value) return [];
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(imageValues);
    if (typeof value === 'object') {
      return imageValues(value.url || value.contentUrl || value.thumbnailUrl);
    }
    return [];
  }

  function extractPrice(product, doc) {
    let amount = '';
    let currency = '';
    const offers = Array.isArray(product?.offers) ? product.offers[0] : product?.offers;
    if (offers && typeof offers === 'object') {
      amount = text(offers.price || offers.lowPrice);
      currency = text(offers.priceCurrency);
    }
    amount ||= metaContent(doc, [
      'meta[property="product:price:amount"]',
      'meta[property="og:price:amount"]',
    ]);
    currency ||= metaContent(doc, [
      'meta[property="product:price:currency"]',
      'meta[property="og:price:currency"]',
    ]);
    if (!amount) return '';
    try {
      if (currency) {
        return new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency: currency.toUpperCase(),
          maximumFractionDigits: Number(amount) % 1 ? 2 : 0,
        }).format(Number(amount));
      }
    } catch {
      // Keep the original storefront value if its currency is non-standard.
    }
    return `${amount}${currency ? ` ${currency.toUpperCase()}` : ''}`;
  }

  function fallbackImage(doc, baseUrl) {
    const candidates = [...doc.images]
      .map((img) => {
        const src = img.getAttribute('src')
          || img.getAttribute('data-src')
          || img.getAttribute('data-original');
        const score = (Number(img.getAttribute('width')) || 0)
          * (Number(img.getAttribute('height')) || 0);
        return { src, score, label: `${img.alt || ''} ${img.className || ''}` };
      })
      .filter(({ src, label }) => src && !/logo|icon|avatar|emoji/i.test(label))
      .sort((a, b) => b.score - a.score);
    return normalizeUrl(candidates[0]?.src, baseUrl);
  }

  function parsePage(html, responseUrl, originalUrl) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const product = jsonLdProducts(doc)[0] || {};
    const baseUrl = normalizeUrl(responseUrl || originalUrl) || originalUrl;
    const imageCandidates = [
      ...imageValues(product.image),
      ...[...doc.querySelectorAll('meta[property="og:image"], meta[property="og:image:url"], meta[name="twitter:image"], meta[name="twitter:image:src"]')]
        .map((node) => node.getAttribute('content')),
    ];

    const images = unique(imageCandidates.map((url) => normalizeUrl(url, baseUrl)));
    if (!images.length) {
      const fallback = fallbackImage(doc, baseUrl);
      if (fallback) images.push(fallback);
    }

    const title = text(
      product.name
      || metaContent(doc, ['meta[property="og:title"]', 'meta[name="twitter:title"]'])
      || doc.title,
    );
    const description = truncate(
      product.description
      || metaContent(doc, [
        'meta[property="og:description"]',
        'meta[name="twitter:description"]',
        'meta[name="description"]',
      ]),
      CONFIG.maxDescriptionLength,
    );

    return {
      url: baseUrl,
      title,
      description,
      price: extractPrice(product, doc),
      images: images.slice(0, CONFIG.maxImages),
    };
  }

  function requestPreview(url) {
    if (DIRECT_IMAGE_RE.test(new URL(url).pathname)) {
      return Promise.resolve({
        url,
        title: decodeURIComponent(new URL(url).pathname.split('/').pop() || 'Изображение'),
        description: '',
        price: '',
        images: [url],
      });
    }

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: CONFIG.requestTimeoutMs,
        anonymous: false,
        headers: {
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.7',
        },
        onload(response) {
          if (response.status < 200 || response.status >= 400) {
            reject(new Error(`HTTP ${response.status}`));
            return;
          }
          const result = parsePage(response.responseText, response.finalUrl, url);
          if (!result.images.length && !result.title) {
            reject(new Error('Метаданные предпросмотра не найдены'));
            return;
          }
          resolve(result);
        },
        ontimeout() {
          reject(new Error('Сайт слишком долго не отвечает'));
        },
        onerror() {
          reject(new Error('Магазин отклонил запрос'));
        },
        onabort() {
          reject(new Error('Запрос отменён'));
        },
      });
    });
  }

  function getPreview(url) {
    let promise = cache.get(url);
    if (!promise) {
      promise = requestPreview(url);
      cache.set(url, promise);
      promise.catch(() => cache.delete(url));
    }
    return promise;
  }

  function clearCard() {
    card.replaceChildren();
  }

  function addElement(parent, tag, className, value) {
    const element = document.createElement(tag);
    element.className = className;
    if (value) element.textContent = value;
    parent.append(element);
    return element;
  }

  function renderLoading(url) {
    clearCard();
    const loading = addElement(card, 'div', 'loading');
    addElement(loading, 'span', 'spinner');
    const message = addElement(loading, 'div', '', 'Загружаю предпросмотр…');
    addElement(message, 'div', 'hint', new URL(url).hostname);
    showCard();
  }

  function renderError(url, error) {
    clearCard();
    const box = addElement(card, 'div', 'error');
    addElement(box, 'strong', '', 'Предпросмотр недоступен');
    addElement(box, 'div', '', error?.message || 'Не удалось прочитать страницу товара');
    addElement(box, 'div', 'hint', `${new URL(url).hostname} · ссылка всё равно открывается обычным кликом`);
    showCard();
  }

  function renderPreview(data) {
    clearCard();
    if (data.images.length) {
      const media = addElement(card, 'div', `media${data.images.length === 1 ? ' single' : ''}`);
      for (const src of data.images) {
        const image = document.createElement('img');
        image.src = src;
        image.alt = '';
        image.loading = 'eager';
        image.decoding = 'async';
        image.referrerPolicy = 'no-referrer';
        image.addEventListener('error', () => image.remove(), { once: true });
        media.append(image);
      }
    }
    const body = addElement(card, 'div', 'body');
    addElement(body, 'div', 'domain', new URL(data.url).hostname);
    addElement(body, 'div', 'title', data.title || 'Страница товара');
    if (data.price) {
      const meta = addElement(body, 'div', 'meta');
      addElement(meta, 'span', 'price', data.price);
    }
    if (data.description) addElement(body, 'div', 'description', data.description);
    showCard();
  }

  function positionCard() {
    if (!card.classList.contains('visible')) return;
    const margin = 12;
    const gap = 16;
    const rect = card.getBoundingClientRect();
    let left = mouseX + gap;
    let top = mouseY + gap;
    if (left + rect.width + margin > innerWidth) left = mouseX - rect.width - gap;
    if (top + rect.height + margin > innerHeight) top = mouseY - rect.height - gap;
    left = Math.max(margin, Math.min(left, innerWidth - rect.width - margin));
    top = Math.max(margin, Math.min(top, innerHeight - rect.height - margin));
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
  }

  function showCard() {
    card.classList.add('visible');
    requestAnimationFrame(positionCard);
  }

  function hideCard() {
    clearTimeout(hoverTimer);
    hoverTimer = 0;
    activeAnchor = null;
    card.classList.remove('visible');
  }

  async function openPreview(anchor) {
    const url = normalizeUrl(anchor.href);
    if (!url || anchor !== activeAnchor) return;
    renderLoading(url);
    try {
      const data = await getPreview(url);
      if (anchor === activeAnchor) renderPreview(data);
    } catch (error) {
      if (anchor === activeAnchor && error?.message !== 'Запрос отменён') renderError(url, error);
    }
  }

  function isInViewport(element) {
    const rect = element.getBoundingClientRect();
    return rect.bottom >= 0
      && rect.right >= 0
      && rect.top <= innerHeight
      && rect.left <= innerWidth;
  }

  function enqueuePrefetch(anchor, priority = false) {
    if (!CONFIG.prefetchEnabled || !isPreviewable(anchor)) return;
    const url = normalizeUrl(anchor.href);
    if (!url
      || cache.has(url)
      || queuedUrls.has(url)
      || prefetchAttempted.has(url)
      || prefetchAttempted.size + queuedUrls.size >= CONFIG.maxPrefetchLinks) return;

    queuedUrls.add(url);
    if (priority) prefetchQueue.unshift(url);
    else prefetchQueue.push(url);
  }

  function pumpPrefetchQueue() {
    if (!CONFIG.prefetchEnabled) return;
    if (document.hidden) {
      setTimeout(pumpPrefetchQueue, 1000);
      return;
    }

    while (prefetchActive < CONFIG.prefetchConcurrency && prefetchQueue.length) {
      const url = prefetchQueue.shift();
      queuedUrls.delete(url);
      prefetchAttempted.add(url);
      prefetchActive += 1;
      getPreview(url)
        .catch(() => {
          // A failed background request is silently retried if the user hovers the link.
        })
        .finally(() => {
          prefetchActive -= 1;
          setTimeout(pumpPrefetchQueue, CONFIG.prefetchGapMs);
        });
    }
  }

  function scanLinksForPrefetch(root = document) {
    const anchors = [];
    if (root instanceof HTMLAnchorElement) anchors.push(root);
    if (root.querySelectorAll) anchors.push(...root.querySelectorAll('a[href]'));

    const previewable = anchors.filter(isPreviewable);
    for (const anchor of previewable.filter(isInViewport)) enqueuePrefetch(anchor, true);
    for (const anchor of previewable.filter((anchor) => !isInViewport(anchor))) enqueuePrefetch(anchor);
    pumpPrefetchQueue();
  }

  function startPrefetching() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!CONFIG.prefetchEnabled || connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || '')) return;

    scanLinksForPrefetch();
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) scanLinksForPrefetch(node);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  document.addEventListener('pointermove', (event) => {
    mouseX = event.clientX;
    mouseY = event.clientY;
    positionCard();

    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (anchor === activeAnchor) return;
    clearTimeout(hoverTimer);
    card.classList.remove('visible');
    activeAnchor = isPreviewable(anchor) ? anchor : null;
    if (activeAnchor) {
      hoverTimer = window.setTimeout(() => openPreview(activeAnchor), CONFIG.hoverDelayMs);
    }
  }, { passive: true });

  document.addEventListener('pointerleave', hideCard, { passive: true });
  document.addEventListener('scroll', hideCard, { passive: true, capture: true });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideCard();
  });

  setTimeout(startPrefetching, CONFIG.prefetchStartDelayMs);
})();
