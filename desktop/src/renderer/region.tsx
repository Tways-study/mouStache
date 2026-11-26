// The shim MUST be evaluated first (shared overlay modules import wxt/browser).
import './chrome-shim';
import './region.css';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RegionSelect } from '@/components/overlay/RegionSelect';
import { applyAppearance, type Appearance } from '@/lib/appearance';
import { getSettings } from '@/lib/settings';
import { cropImage, type CropRect } from '@/lib/thumbs';

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/**
 * Freeze-frame region select: main sends a picture of the display, the shared RegionSelect lets the user drag a
 * rectangle over it, cropImage cuts it out and the PNG goes back to main to be saved.
 */
function App() {
  const [shot, setShot] = useState<string>();

  useEffect(() => {
    window.mouDesktop?.onRegionShow((r) => setShot(r.dataUrl));
    void getSettings().then((s: Appearance) => applyAppearance(document.documentElement, s), () => undefined);
  }, []);

  const onSelect = async (rect: CropRect) => {
    if (!shot) return;
    try {
      const cropped = await cropImage(await (await fetch(shot)).blob(), rect);
      window.mouDesktop?.regionDone(await blobToDataUrl(cropped));
    } catch {
      window.mouDesktop?.regionCancel();
    }
  };

  return (
    <div className="font-sans text-label-primary">
      {shot && <img className="region-shot" src={shot} alt="" draggable={false} />}
      <RegionSelect onSelect={(r) => void onSelect(r)} onCancel={() => window.mouDesktop?.regionCancel()} />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
