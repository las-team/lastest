'use client';

import { useState } from 'react';
import { Globe, Maximize2, Minimize2, Camera, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const VIEWPORT_PRESETS = [
  { label: '1280×720', width: 1280, height: 720 },
  { label: '1920×1080', width: 1920, height: 1080 },
  { label: '1024×768', width: 1024, height: 768 },
  { label: '375×812 (Mobile)', width: 375, height: 812 },
  { label: '768×1024 (Tablet)', width: 768, height: 1024 },
];

interface BrowserToolbarProps {
  currentUrl?: string;
  viewport: { width: number; height: number };
  isFullscreen: boolean;
  onNavigate?: (url: string) => void;
  onViewportChange?: (viewport: { width: number; height: number }) => void;
  onScreenshot?: () => void;
  onFullscreenToggle?: () => void;
}

export function BrowserToolbar({
  currentUrl,
  viewport,
  isFullscreen,
  onNavigate,
  onViewportChange,
  onScreenshot,
  onFullscreenToggle,
}: BrowserToolbarProps) {
  const [urlInput, setUrlInput] = useState(currentUrl ?? '');

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (urlInput.trim()) {
      let url = urlInput.trim();
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `https://${url}`;
      }
      onNavigate?.(url);
    }
  };

  const viewportLabel = `${viewport.width}×${viewport.height}`;

  return (
    <div className="flex items-center gap-2 rounded-t-lg border border-b-0 bg-muted/50 px-3 py-2">
      {/* URL Bar */}
      <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
      <form onSubmit={handleUrlSubmit} className="flex-1">
        <Input
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="Enter URL..."
          className="h-7 text-sm"
        />
      </form>

      {/* Viewport selector */}
      <Select
        value={viewportLabel}
        onValueChange={(val) => {
          const preset = VIEWPORT_PRESETS.find((p) => `${p.width}×${p.height}` === val);
          if (preset) {
            onViewportChange?.({ width: preset.width, height: preset.height });
          }
        }}
      >
        <SelectTrigger className="h-7 w-[160px] text-xs">
          <Monitor className="mr-1 h-3 w-3" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {VIEWPORT_PRESETS.map((preset) => (
            <SelectItem key={preset.label} value={`${preset.width}×${preset.height}`}>
              {preset.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Screenshot */}
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onScreenshot} title="Take screenshot">
        <Camera className="h-4 w-4" />
      </Button>

      {/* Fullscreen */}
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onFullscreenToggle} title="Toggle fullscreen">
        {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </Button>
    </div>
  );
}
