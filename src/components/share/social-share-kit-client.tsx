"use client";

// Social share kit for the public /r/<slug> page. Replaces the old plain-text
// SocialShareRow with icon buttons and platform-specific "share assistants".
// Only X and LinkedIn have web intents that prefill their composers (text
// only) — no platform accepts media or upload metadata through a URL. So each
// dialog gets as close to a prefilled screen as its platform allows: Web Share
// hands video + text straight into the app's composer, YouTube's Title
// prefills from the download's filename, copy-and-open buttons put the
// caption/description on the clipboard as the uploader opens, and the media
// is prepared client-side (streamed .webm download, screenshot zip for TikTok
// slideshows). Playwright records .webm; platforms that need MP4 (X, LinkedIn,
// TikTok) get a copy-paste ffmpeg command rather than a slow in-browser
// re-encode.

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Check,
  ClipboardPaste,
  Copy,
  Download,
  ExternalLink,
  Images,
  Link2,
  Loader2,
  Share2,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { buildZip, type ZipEntry } from "@/lib/share/client-zip";
import type { SocialCopy } from "@/lib/share/social-copy";

export interface ShareSlide {
  url: string;
  label: string;
}

export interface SocialShareKitProps {
  shareUrl: string;
  /** Basis for downloaded filenames, e.g. the test name or domain. */
  title: string;
  copy: SocialCopy;
  /** Same-origin /share/<slug>/... URL of the run recording, when one exists. */
  videoUrl: string | null;
  /** Step screenshots for the TikTok slideshow flow, in capture order. */
  slides: ShareSlide[];
}

export function SocialShareKit({
  shareUrl,
  title,
  copy,
  videoUrl,
  slides,
}: SocialShareKitProps) {
  const fileStem = useMemo(() => slugify(title), [title]);

  return (
    <section className="space-y-2 pt-2 border-t">
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Share this run
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        <XShareDialog copy={copy} videoUrl={videoUrl} fileStem={fileStem} />
        <YouTubeShareDialog copy={copy} videoUrl={videoUrl} />
        <TikTokShareDialog
          copy={copy}
          videoUrl={videoUrl}
          slides={slides}
          fileStem={fileStem}
        />
        <LinkedInShareDialog
          copy={copy}
          videoUrl={videoUrl}
          fileStem={fileStem}
        />
        <CopyLinkChip shareUrl={shareUrl} />
      </div>
    </section>
  );
}

// --- X ------------------------------------------------------------------------

function XShareDialog({
  copy,
  videoUrl,
  fileStem,
}: {
  copy: SocialCopy;
  videoUrl: string | null;
  fileStem: string;
}) {
  const intent = `https://x.com/intent/post?text=${encodeURIComponent(copy.x)}`;

  // Without a recording there is nothing to attach — keep the one-click intent.
  if (!videoUrl) {
    return (
      <ShareChip asChild>
        <a href={intent} target="_blank" rel="noopener noreferrer">
          <XLogo className="size-3.5" />
          Post to X
        </a>
      </ShareChip>
    );
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <ShareChip>
          <XLogo className="size-3.5" />
          Post to X
        </ShareChip>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Post to X with the recording</DialogTitle>
          <DialogDescription>
            X can&apos;t receive a video through a share link, so grab the clip
            first and attach it to the prefilled post.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <OneTapShare
            videoUrl={videoUrl}
            downloadName={fileStem}
            text={copy.x}
            appName="X"
          />
          <StepBlock n={1} label="Download the recording, then convert for X">
            <VideoDownloadButton
              videoUrl={videoUrl}
              fileStem={fileStem}
              preferMp4
            />
          </StepBlock>
          <StepBlock n={2} label="Post text (prefilled — edit away)">
            <CopyField value={copy.x} rows={5} ariaLabel="X post text" />
          </StepBlock>
          <StepBlock n={3} label="Open the composer and attach the video">
            <Button asChild size="sm">
              <a href={intent} target="_blank" rel="noopener noreferrer">
                <XLogo className="size-3.5" />
                Open X composer
                <ExternalLink className="size-3.5" />
              </a>
            </Button>
          </StepBlock>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- LinkedIn -------------------------------------------------------------------

function LinkedInShareDialog({
  copy,
  videoUrl,
  fileStem,
}: {
  copy: SocialCopy;
  videoUrl: string | null;
  fileStem: string;
}) {
  // LinkedIn's feed composer still honours text prefill — unlike the legacy
  // share-offsite URL (which only carries the link), this opens the "start a
  // post" screen with the full post written; the trailing share URL unfurls
  // into the OG card.
  const composer = `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(copy.linkedin)}`;

  // Without a recording the prefilled composer is the whole flow.
  if (!videoUrl) {
    return (
      <ShareChip asChild>
        <a href={composer} target="_blank" rel="noopener noreferrer">
          <LinkedInLogo className="size-3.5" />
          LinkedIn
        </a>
      </ShareChip>
    );
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <ShareChip>
          <LinkedInLogo className="size-3.5" />
          LinkedIn
        </ShareChip>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Post to LinkedIn with the recording</DialogTitle>
          <DialogDescription>
            The composer opens with the post already written. Attach the
            recording for a video post, or post as-is and LinkedIn unfurls the
            report link into a preview card.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <OneTapShare
            videoUrl={videoUrl}
            downloadName={fileStem}
            text={copy.linkedin}
            appName="LinkedIn"
          />
          <StepBlock
            n={1}
            label="Download the recording, then convert for LinkedIn"
          >
            <VideoDownloadButton
              videoUrl={videoUrl}
              fileStem={fileStem}
              preferMp4
            />
          </StepBlock>
          <StepBlock n={2} label="Post text (prefilled in the composer too)">
            <CopyField
              value={copy.linkedin}
              rows={6}
              ariaLabel="LinkedIn post text"
            />
          </StepBlock>
          <StepBlock
            n={3}
            label="Open the prefilled composer and attach the video"
          >
            <Button asChild size="sm">
              <a href={composer} target="_blank" rel="noopener noreferrer">
                <LinkedInLogo className="size-3.5" />
                Open LinkedIn composer
                <ExternalLink className="size-3.5" />
              </a>
            </Button>
          </StepBlock>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- YouTube --------------------------------------------------------------------

function YouTubeShareDialog({
  copy,
  videoUrl,
}: {
  copy: SocialCopy;
  videoUrl: string | null;
}) {
  if (!videoUrl) return null;
  // YouTube prefills the upload form's Title field from the uploaded file's
  // name — so the downloaded file IS the title prefill. Keep it human-readable
  // (spaces, case) rather than a slug.
  const titleFilename = sanitizeFilename(copy.youtube.title);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <ShareChip>
          <YouTubeLogo className="size-3.5" />
          YouTube
        </ShareChip>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload to YouTube</DialogTitle>
          <DialogDescription>
            YouTube has no prefillable upload link, so this gets as close as
            possible: the file is named so YouTube prefills the Title from it,
            and the description lands on your clipboard as the form opens.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <OneTapShare
            videoUrl={videoUrl}
            downloadName={titleFilename}
            text={copy.youtube.description}
            appName="YouTube"
          />
          <StepBlock
            n={1}
            label="Download the recording (filename = video title)"
          >
            <VideoDownloadButton
              videoUrl={videoUrl}
              fileStem={titleFilename}
              webmNote="YouTube accepts .webm directly and prefills the upload's Title field from this filename."
            />
          </StepBlock>
          <StepBlock n={2} label="Metadata (prefilled — tweak if you like)">
            <div className="space-y-3">
              <LabeledCopyField label="Title" value={copy.youtube.title} />
              <LabeledCopyField
                label="Description (includes chapters + report link)"
                value={copy.youtube.description}
                rows={8}
              />
              <LabeledCopyField label="Tags" value={copy.youtube.tags} />
            </div>
          </StepBlock>
          <StepBlock n={3} label="Upload — title prefills from the filename">
            <CopyAndOpenButton
              copyValue={copy.youtube.description}
              copyWhat="description"
              href="https://www.youtube.com/upload"
            >
              <YouTubeLogo className="size-3.5" />
              Copy description &amp; open YouTube
              <ExternalLink className="size-3.5" />
            </CopyAndOpenButton>
          </StepBlock>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- TikTok ---------------------------------------------------------------------

function TikTokShareDialog({
  copy,
  videoUrl,
  slides,
  fileStem,
}: {
  copy: SocialCopy;
  videoUrl: string | null;
  slides: ShareSlide[];
  fileStem: string;
}) {
  const hasVideo = !!videoUrl;
  const hasSlides = slides.length >= 2;
  if (!hasVideo && !hasSlides) return null;

  // TikTok has no prefillable upload URL either — copy the caption in the
  // same click that opens the uploader, so the compose screen is one paste
  // away from fully filled.
  const uploadButton = (
    <CopyAndOpenButton
      copyValue={copy.tiktok}
      copyWhat="caption"
      href="https://www.tiktok.com/tiktokstudio/upload"
    >
      <TikTokLogo className="size-3.5" />
      Copy caption &amp; open TikTok
      <ExternalLink className="size-3.5" />
    </CopyAndOpenButton>
  );

  return (
    <Dialog>
      <DialogTrigger asChild>
        <ShareChip>
          <TikTokLogo className="size-3.5" />
          TikTok
        </ShareChip>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Share on TikTok</DialogTitle>
          <DialogDescription>
            Post the run as a video, or as a swipeable photo slideshow built
            from the step screenshots. Caption is prefilled below.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <LabeledCopyField
            label="Caption (hashtags + report link included)"
            value={copy.tiktok}
            rows={6}
          />
          <Tabs defaultValue={hasVideo ? "video" : "slideshow"}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="video" disabled={!hasVideo}>
                <Video className="size-3.5" />
                Video
              </TabsTrigger>
              <TabsTrigger value="slideshow" disabled={!hasSlides}>
                <Images className="size-3.5" />
                Slideshow
              </TabsTrigger>
            </TabsList>
            <TabsContent value="video" className="space-y-4 pt-3">
              {videoUrl && (
                <>
                  <OneTapShare
                    videoUrl={videoUrl}
                    downloadName={fileStem}
                    text={copy.tiktok}
                    appName="TikTok"
                  />
                  <StepBlock
                    n={1}
                    label="Download the recording, then convert for TikTok"
                  >
                    <VideoDownloadButton
                      videoUrl={videoUrl}
                      fileStem={fileStem}
                      preferMp4
                    />
                  </StepBlock>
                  <StepBlock n={2} label="Upload the video and paste">
                    {uploadButton}
                  </StepBlock>
                </>
              )}
            </TabsContent>
            <TabsContent value="slideshow" className="space-y-4 pt-3">
              <StepBlock
                n={1}
                label={`Download the ${slides.length} step screenshots`}
              >
                <SlideshowDownload slides={slides} fileStem={fileStem} />
              </StepBlock>
              <StepBlock
                n={2}
                label="Upload — select all images and TikTok builds the slideshow"
              >
                {uploadButton}
              </StepBlock>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SlideshowDownload({
  slides,
  fileStem,
}: {
  slides: ShareSlide[];
  fileStem: string;
}) {
  const [state, setState] = useState<"idle" | "working" | "done" | "error">(
    "idle",
  );

  const download = async () => {
    setState("working");
    try {
      const entries: ZipEntry[] = [];
      for (let i = 0; i < slides.length; i++) {
        const s = slides[i];
        const res = await fetch(s.url);
        if (!res.ok) continue;
        const buf = new Uint8Array(await res.arrayBuffer());
        const ext = extensionOf(s.url) ?? "png";
        const idx = `${i + 1}`.padStart(2, "0");
        entries.push({ name: `${idx}-${slugify(s.label)}.${ext}`, data: buf });
      }
      if (entries.length === 0) throw new Error("no slides fetched");
      triggerDownload(buildZip(entries), `${fileStem}-slides.zip`);
      setState("done");
    } catch {
      setState("error");
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {slides.slice(0, 8).map((s, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            src={s.url}
            alt={s.label}
            loading="lazy"
            className="h-12 w-9 rounded border object-cover object-top"
          />
        ))}
        {slides.length > 8 && (
          <span className="flex h-12 w-9 items-center justify-center rounded border text-[10px] text-muted-foreground">
            +{slides.length - 8}
          </span>
        )}
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={download}
        disabled={state === "working"}
      >
        {state === "working" ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : state === "done" ? (
          <Check className="size-3.5" />
        ) : (
          <Download className="size-3.5" />
        )}
        {state === "working"
          ? "Bundling…"
          : state === "done"
            ? "Downloaded"
            : "Download slides (.zip)"}
      </Button>
      {state === "error" && (
        <p className="text-xs text-destructive">
          Couldn&apos;t bundle the screenshots — try again.
        </p>
      )}
    </div>
  );
}

// --- video download (streamed .webm + optional ffmpeg-to-MP4 recipe) ------------

// The ffmpeg one-liner handed to users whose target platform needs MP4. H.264 +
// yuv420p is the broadest-compatibility encode; +faststart moves the moov atom
// up front so the upload previews without a full download.
function ffmpegToMp4Command(stem: string): string {
  return `ffmpeg -i "${stem}.webm" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "${stem}.mp4"`;
}

function VideoDownloadButton({
  videoUrl,
  fileStem,
  preferMp4 = false,
  webmNote,
}: {
  videoUrl: string;
  fileStem: string;
  /** True when the target platform (X, LinkedIn, TikTok app) rejects .webm. */
  preferMp4?: boolean;
  webmNote?: string;
}) {
  const [state, setState] = useState<"idle" | "preparing" | "done" | "error">(
    "idle",
  );
  const [progress, setProgress] = useState(0);

  // Stream the recording in the background (chunked reads keep the tab
  // responsive instead of freezing on a big blob) and hand it to the browser's
  // save dialog once it's ready.
  const downloadWebm = async () => {
    setState("preparing");
    setProgress(0);
    try {
      const blob = await fetchBlobWithProgress(videoUrl, setProgress);
      triggerDownload(blob, `${fileStem}.webm`);
      setState("done");
    } catch {
      // Last resort: hand the URL to the browser directly.
      setState("error");
      window.open(videoUrl, "_blank", "noopener");
    }
  };

  const preparing = state === "preparing";

  return (
    <div className="space-y-2">
      <Button
        size="sm"
        variant="outline"
        onClick={downloadWebm}
        disabled={preparing}
      >
        {preparing ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : state === "done" ? (
          <Check className="size-3.5" />
        ) : (
          <Download className="size-3.5" />
        )}
        {preparing
          ? progress > 0
            ? `Preparing… ${Math.round(progress * 100)}%`
            : "Preparing…"
          : state === "done"
            ? "Downloaded (.webm)"
            : "Download recording (.webm)"}
      </Button>
      {preparing && (
        <p className="text-xs text-muted-foreground">
          Downloading in the background — your browser will save it when
          it&apos;s ready.
        </p>
      )}
      {preferMp4 && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            This platform needs MP4. Download the .webm above, then convert it
            locally with ffmpeg:
          </p>
          <LabeledCopyField
            label="Convert to MP4"
            value={ffmpegToMp4Command(fileStem)}
          />
        </div>
      )}
      {!preferMp4 && webmNote && (
        <p className="text-xs text-muted-foreground">{webmNote}</p>
      )}
      {state === "error" && (
        <p className="text-xs text-muted-foreground">
          Couldn&apos;t prepare the download — opened the recording in a new tab
          instead; use your browser&apos;s Save Video As.
        </p>
      )}
    </div>
  );
}

// --- one-tap Web Share (video + text handed straight to the app) ---------------

// True where navigator.share can carry video files (mobile Chrome/Safari,
// some desktops). The capability never changes during a page's life, so it's
// probed once and served through useSyncExternalStore — the server snapshot
// is false, keeping SSR + hydration consistent, and React re-reads the real
// value after hydrating.
let canShareProbe: boolean | null = null;
function probeCanShareVideoFiles(): boolean {
  if (canShareProbe == null) {
    try {
      const probe = new File([new Uint8Array(1)], "probe.webm", {
        type: "video/webm",
      });
      canShareProbe = !!navigator.canShare?.({ files: [probe] });
    } catch {
      canShareProbe = false;
    }
  }
  return canShareProbe;
}
function useCanShareVideoFiles(): boolean {
  return useSyncExternalStore(
    () => () => {},
    probeCanShareVideoFiles,
    () => false,
  );
}

// The closest thing to a prefilled upload screen the platforms allow: the Web
// Share API hands the video file + post text to the chosen app, which opens
// its composer with the video already attached (X and TikTok prefill the text
// too on most devices). Two clicks by design — streaming the file down outlives
// the user-gesture window navigator.share() requires, so click 1 prepares and
// click 2 shares.
function OneTapShare({
  videoUrl,
  downloadName,
  text,
  appName,
}: {
  videoUrl: string;
  downloadName: string;
  text: string;
  appName: string;
}) {
  const supported = useCanShareVideoFiles();
  const [state, setState] = useState<"idle" | "preparing" | "ready" | "error">(
    "idle",
  );
  const [progress, setProgress] = useState(0);
  const fileRef = useRef<File | null>(null);

  if (!supported) return null;

  const prepare = async () => {
    setState("preparing");
    setProgress(0);
    try {
      const blob = await fetchBlobWithProgress(videoUrl, setProgress);
      const file = new File([blob], `${downloadName}.webm`, {
        type: blob.type || "video/webm",
      });
      if (!navigator.canShare?.({ files: [file] })) {
        throw new Error("file not shareable");
      }
      fileRef.current = file;
      setState("ready");
    } catch {
      setState("error");
    }
  };

  const share = async () => {
    const file = fileRef.current;
    if (!file) return;
    // Belt-and-braces: some apps drop the text when a file is attached, so
    // put it on the clipboard too — worst case it's one paste away.
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard unavailable — the dialog's copy fields still work.
    }
    try {
      await navigator.share({ files: [file], text });
    } catch {
      // User dismissed the sheet — keep the prepared file for another go.
    }
  };

  return (
    <div className="rounded-md border bg-muted/40 p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Share2 className="size-4 shrink-0" />
        Fastest: send it straight to {appName}
      </div>
      {state === "ready" ? (
        <Button size="sm" onClick={share}>
          <Share2 className="size-3.5" />
          Open share sheet
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={prepare}
          disabled={state === "preparing"}
        >
          {state === "preparing" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Video className="size-3.5" />
          )}
          {state === "preparing"
            ? `Preparing video… ${Math.round(progress * 100)}%`
            : "Prepare video"}
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        {state === "ready"
          ? `Pick ${appName} in the sheet — its composer opens with the video attached; the text is prefilled or on your clipboard.`
          : "Hands the video and prefilled text to the app's own composer — no downloads to juggle."}
      </p>
      {state === "error" && (
        <p className="text-xs text-destructive">
          Couldn&apos;t prepare the video for sharing — use the manual steps
          below.
        </p>
      )}
    </div>
  );
}

// --- shared bits ----------------------------------------------------------------

// One click, two effects: the caption/description lands on the clipboard and
// the platform's uploader opens — its form is one paste from prefilled.
function CopyAndOpenButton({
  copyValue,
  copyWhat,
  href,
  children,
}: {
  copyValue: string;
  copyWhat: string;
  href: string;
  children: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const go = async () => {
    try {
      await navigator.clipboard.writeText(copyValue);
      setCopied(true);
      setTimeout(() => setCopied(false), 4000);
    } catch {
      // Clipboard unavailable — the copy fields above still work.
    }
    window.open(href, "_blank", "noopener,noreferrer");
  };
  return (
    <div className="space-y-1.5">
      <Button size="sm" onClick={go}>
        {children}
      </Button>
      <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
        {copied ? (
          <>
            <Check className="size-3" />
            {`Copied — paste the ${copyWhat} into the form.`}
          </>
        ) : (
          <>
            <ClipboardPaste className="size-3" />
            {`Copies the ${copyWhat} as it opens — just paste.`}
          </>
        )}
      </p>
    </div>
  );
}

function ShareChip({
  asChild,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { asChild?: boolean }) {
  return (
    <Button
      asChild={asChild}
      variant="outline"
      size="sm"
      className="h-8 gap-1.5 rounded-md bg-card px-3 text-xs font-medium"
      {...props}
    >
      {children}
    </Button>
  );
}

function CopyLinkChip({ shareUrl }: { shareUrl: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (e.g. insecure context) — select-and-copy is
      // still possible from the address bar; do nothing.
    }
  };
  return (
    <ShareChip onClick={copy} aria-label="Copy share link">
      {copied ? <Check className="size-3.5" /> : <Link2 className="size-3.5" />}
      {copied ? "Copied" : "Copy link"}
    </ShareChip>
  );
}

function StepBlock({
  n,
  label,
  children,
}: {
  n: number;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold">
          {n}
        </span>
        {label}
      </div>
      <div className="pl-7">{children}</div>
    </div>
  );
}

function LabeledCopyField({
  label,
  value,
  rows,
}: {
  label: string;
  value: string;
  rows?: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <CopyField value={value} rows={rows} ariaLabel={label} />
    </div>
  );
}

function CopyField({
  value,
  rows,
  ariaLabel,
}: {
  value: string;
  rows?: number;
  ariaLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Field stays selectable for manual copy.
    }
  };
  return (
    <div className="flex items-start gap-2">
      {rows && rows > 1 ? (
        <Textarea
          readOnly
          value={value}
          rows={rows}
          aria-label={ariaLabel}
          className="text-xs font-mono"
          onFocus={(e) => e.currentTarget.select()}
        />
      ) : (
        <Input
          readOnly
          value={value}
          aria-label={ariaLabel}
          className="text-xs font-mono"
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
      <Button
        size="sm"
        variant="outline"
        onClick={copy}
        aria-label={`Copy ${ariaLabel}`}
        className="shrink-0"
      >
        {copied ? (
          <Check className="size-3.5" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </Button>
    </div>
  );
}

// Stream a same-origin asset into a Blob, reporting 0..1 progress as bytes
// arrive. Chunked reads yield to the event loop between reads, so a large
// recording downloads without freezing the tab (unlike a single blocking
// `await res.blob()`). Falls back to a plain blob() when the body isn't a
// readable stream, and reports indeterminate progress (0) when the server
// sends no Content-Length.
async function fetchBlobWithProgress(
  url: string,
  onProgress?: (fraction: number) => void,
): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  const type = res.headers.get("content-type") || "video/webm";
  const reader = res.body?.getReader();
  if (!reader) return res.blob();

  const total = Number(res.headers.get("content-length")) || 0;
  const chunks: BlobPart[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.length;
      if (total) onProgress?.(Math.min(1, received / total));
    }
  }
  onProgress?.(1);
  return new Blob(chunks, { type });
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a beat to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// Human-readable filename (spaces and case preserved) — used where the
// filename itself is the prefill, e.g. YouTube derives the upload's Title
// from it. Only strips characters that are illegal in filenames.
function sanitizeFilename(s: string): string {
  return (
    s
      .replace(/[/\\:*?"<>|\u0000-\u001f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "lastest-run"
  );
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "lastest-run"
  );
}

function extensionOf(url: string): string | null {
  const m = url.split("?")[0].match(/\.([a-z0-9]{2,5})$/i);
  return m ? m[1].toLowerCase() : null;
}

// --- brand marks (lucide dropped brand icons, so inline the SVGs) ---------------

function XLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      fill="currentColor"
      className={className}
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function LinkedInLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      fill="currentColor"
      className={className}
    >
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z" />
    </svg>
  );
}

function YouTubeLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      fill="currentColor"
      className={className}
    >
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

function TikTokLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      fill="currentColor"
      className={className}
    >
      <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
    </svg>
  );
}
