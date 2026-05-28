'use client';
import { useEffect, useState } from 'react';
import semver from 'semver';

interface ContentManifest {
  current_version: string;
  min_client_version: string;
  schema_version: number;
}

export default function ServiceWorkerRegister() {
  const [updateRequired, setUpdateRequired] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.1.0';

    // 1. min_client_version 체크 (manifest fetch)
    const checkVersionCompat = async () => {
      try {
        const base = process.env.NEXT_PUBLIC_CONTENT_BASE_URL ?? '';
        const url = base ? `${base}/manifest.json` : '/content/manifest.json';
        const resp = await fetch(url, { cache: 'no-cache' });
        if (!resp.ok) return;
        const manifest: ContentManifest = await resp.json();
        if (manifest.min_client_version && semver.lt(APP_VERSION, manifest.min_client_version)) {
          setUpdateRequired(true);
          // SW 캐시 무효화
          if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHES' });
          }
        }
      } catch {
        // manifest fetch 실패 → 마지막 cached 사용 (compatible 가정)
      }
    };

    if (process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
        console.warn('SW register failed:', err);
      });

      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    }

    // 버전 체크는 dev/prod 모두
    checkVersionCompat();
  }, []);

  if (updateRequired) {
    return (
      <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl p-6 max-w-sm text-center">
          <div className="text-4xl mb-3">🔄</div>
          <h2 className="text-xl font-bold mb-2">업데이트가 필요합니다</h2>
          <p className="text-sm text-gray-600 mb-4">
            새 버전으로 업데이트해 주세요.<br />
            iOS 사용자는 앱을 다시 열어주세요.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="w-full rounded-xl bg-brand py-3 text-white font-medium"
          >
            새로고침
          </button>
        </div>
      </div>
    );
  }

  return null;
}
