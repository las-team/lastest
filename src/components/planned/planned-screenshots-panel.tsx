'use client';

import { useState } from 'react';
import { Image as ImageIcon, Trash2, ExternalLink, Plus, X, Eye } from 'lucide-react';
import { PlannedScreenshotUploader } from './planned-screenshot-uploader';
import { deletePlannedScreenshot } from '@/server/actions/planned-screenshots';

interface PlannedScreenshot {
  id: string;
  imagePath: string;
  name: string | null;
  description: string | null;
  stepLabel: string | null;
  sourceUrl: string | null;
  createdAt: Date | null;
}

interface PlannedScreenshotsPanelProps {
  repositoryId: string;
  testId?: string;
  plannedScreenshots: PlannedScreenshot[];
  onUpdate?: () => void;
  className?: string;
}

export function PlannedScreenshotsPanel({
  repositoryId,
  testId,
  plannedScreenshots,
  onUpdate,
  className = '',
}: PlannedScreenshotsPanelProps) {
  const [showUploader, setShowUploader] = useState(false);
  const [selectedImage, setSelectedImage] = useState<PlannedScreenshot | null>(null);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this planned screenshot?')) return;

    setIsDeleting(id);
    try {
      await deletePlannedScreenshot(id);
      onUpdate?.();
    } catch (error) {
      console.error('Failed to delete:', error);
    } finally {
      setIsDeleting(null);
    }
  };

  const handleUploadComplete = () => {
    setShowUploader(false);
    onUpdate?.();
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
          <ImageIcon className="w-4 h-4 text-purple-500" />
          Planned Screenshots
          {plannedScreenshots.length > 0 && (
            <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
              {plannedScreenshots.length}
            </span>
          )}
        </h3>
        {!showUploader && (
          <button
            onClick={() => setShowUploader(true)}
            className="text-sm text-purple-600 hover:text-purple-700 flex items-center gap-1"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
        )}
      </div>

      {/* Uploader */}
      {showUploader && (
        <div className="border border-purple-200 rounded-lg p-4 bg-purple-50/50">
          <PlannedScreenshotUploader
            repositoryId={repositoryId}
            testId={testId}
            onUploadComplete={handleUploadComplete}
            onCancel={() => setShowUploader(false)}
          />
        </div>
      )}

      {/* Screenshots Grid */}
      {plannedScreenshots.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {plannedScreenshots.map((screenshot) => (
            <div
              key={screenshot.id}
              className="group relative border rounded-lg overflow-hidden bg-white"
            >
              {/* Thumbnail */}
              <div
                className="aspect-video cursor-pointer"
                onClick={() => setSelectedImage(screenshot)}
              >
                <img
                  src={screenshot.imagePath}
                  alt={screenshot.name || 'Planned screenshot'}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover"
                />
              </div>

              {/* Overlay actions */}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                <button
                  onClick={() => setSelectedImage(screenshot)}
                  className="p-2 bg-white rounded-full shadow-lg mr-2"
                  title="View"
                >
                  <Eye className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(screenshot.id)}
                  disabled={isDeleting === screenshot.id}
                  className="p-2 bg-white rounded-full shadow-lg text-red-500 hover:text-red-600"
                  title="Delete"
                >
                  {isDeleting === screenshot.id ? (
                    <div className="w-4 h-4 border-2 border-red-300 border-t-red-500 rounded-full animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                </button>
              </div>

              {/* Info */}
              <div className="p-2 text-xs">
                {screenshot.name && (
                  <div className="font-medium text-gray-700 truncate">
                    {screenshot.name}
                  </div>
                )}
                {screenshot.stepLabel && (
                  <div className="text-gray-500 truncate">
                    Step: {screenshot.stepLabel}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : !showUploader ? (
        <div className="text-center py-8 text-gray-500 border-2 border-dashed rounded-lg">
          <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No planned screenshots</p>
          <p className="text-xs mt-1">Upload design mockups to compare against actual screenshots</p>
        </div>
      ) : null}

      {/* Lightbox/Modal */}
      {selectedImage && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedImage(null)}
        >
          <div
            className="bg-white rounded-lg max-w-4xl max-h-[90vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between p-4 border-b">
              <div>
                <h4 className="font-medium">
                  {selectedImage.name || 'Planned Screenshot'}
                </h4>
                {selectedImage.stepLabel && (
                  <p className="text-sm text-gray-500">Step: {selectedImage.stepLabel}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {selectedImage.sourceUrl && (
                  <a
                    href={selectedImage.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 text-gray-500 hover:text-gray-700"
                    title="Open source"
                  >
                    <ExternalLink className="w-5 h-5" />
                  </a>
                )}
                <button
                  onClick={() => setSelectedImage(null)}
                  className="p-2 text-gray-500 hover:text-gray-700"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal body */}
            <div className="p-4 overflow-auto max-h-[calc(90vh-120px)]">
              <img
                src={selectedImage.imagePath}
                alt={selectedImage.name || 'Planned screenshot'}
                className="max-w-full"
              />
              {selectedImage.description && (
                <p className="mt-4 text-sm text-gray-600">
                  {selectedImage.description}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
