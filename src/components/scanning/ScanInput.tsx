"use client";
import CameraAlt from "@mui/icons-material/CameraAlt";
import Close from "@mui/icons-material/Close";
import QrCodeScanner from "@mui/icons-material/QrCodeScanner";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { forwardRef, useEffect, useRef, useState, type FormEvent } from "react";
import { MONO } from "@/theme/theme";

interface DetectedBarcode { rawValue?: string }
interface BarcodeDetectorLike { detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]> }
type BarcodeDetectorConstructor = {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};
type BarcodeWindow = Window & { BarcodeDetector?: BarcodeDetectorConstructor };

const BARCODE_FORMATS = ["code_128", "code_39", "code_93", "codabar", "ean_13", "ean_8", "itf", "upc_a", "upc_e", "qr_code", "data_matrix", "pdf417"] as const;

interface Props {
  onScan: (code: string) => void;
  disabled?: boolean;
  busy?: boolean;
  label?: string;
  helperText?: string;
  error?: boolean;
  cameraEnabled?: boolean;
}

/**
 * Keyboard-wedge scanner plus browser camera barcode scanning. Camera scanning needs a secure
 * context (HTTPS or localhost) and a browser implementing BarcodeDetector; the text field remains
 * available on every device as the reliable manual / Bluetooth scanner fallback.
 */
export const ScanInput = forwardRef<HTMLInputElement, Props>(function ScanInput({ onScan, disabled, busy, label = "Scan or type an item", helperText, error, cameraEnabled = true }, ref) {
  const [value, setValue] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const onScanRef = useRef(onScan);
  useEffect(() => { onScanRef.current = onScan; }, [onScan]);

  useEffect(() => {
    if (!cameraOpen) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stream: MediaStream | undefined;

    const stop = () => {
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    const start = async () => {
      try {
        const Detector = (window as BarcodeWindow).BarcodeDetector;
        if (!Detector) {
          setCameraError("This browser does not provide native barcode decoding. Use Chrome on Android, try an updated browser, or scan with a Bluetooth/USB scanner.");
          return;
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          setCameraError("Camera access is unavailable. Open the WMS over HTTPS or localhost and allow camera permission.");
          return;
        }
        // Ask the browser which formats it supports. Passing one unsupported format to
        // BarcodeDetector can make construction fail even if the browser supports others.
        const supported = await Detector.getSupportedFormats?.().catch(() => undefined);
        const formats = supported ? BARCODE_FORMATS.filter((format) => supported.includes(format)) : [...BARCODE_FORMATS];
        if (formats.length === 0) {
          setCameraError("This browser can open the camera but its barcode decoder reports no supported formats. Use an updated Chrome/Edge browser or a Bluetooth/USB scanner.");
          return;
        }
        const detector = new Detector({ formats: [...formats] });
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
        if (disposed) { stream.getTracks().forEach((track) => track.stop()); return; }
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const scanFrame = async () => {
          if (disposed || !videoRef.current) return;
          try {
            if (videoRef.current.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
              const found = await detector.detect(videoRef.current);
              const code = found.map((x) => x.rawValue?.trim()).find((x) => Boolean(x));
              if (code) {
                onScanRef.current(code!);
                setValue("");
                setCameraOpen(false);
                return;
              }
            }
          } catch {
            // Some decoders throw while the camera is warming up; keep scanning the next frame.
          }
          timer = setTimeout(() => { void scanFrame(); }, 180);
        };
        void scanFrame();
      } catch (e) {
        if (!disposed) setCameraError(e instanceof Error && e.name === "NotAllowedError"
          ? "Camera permission was denied. Allow camera access in your browser settings, then try again."
          : "The camera could not be started. Check that another app is not using it and retry.");
      }
    };

    void start();
    return () => { disposed = true; stop(); };
  }, [cameraOpen]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const code = value.trim();
    if (!code || disabled || busy) return;
    onScan(code);
    setValue("");
  };

  return (
    <>
      <Box component="form" onSubmit={submit} sx={{ borderLeft: 6, borderColor: disabled ? "divider" : "secondary.main", pl: 1.5 }}>
        <TextField
          fullWidth
          size="medium"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          inputRef={ref}
          autoFocus
          disabled={disabled}
          error={error}
          label={label}
          helperText={helperText}
          autoComplete="off"
          slotProps={{
            htmlInput: { inputMode: "text", enterKeyHint: "done", autoCapitalize: "characters", spellCheck: false, "aria-label": label, style: { fontFamily: MONO, fontSize: "1.125rem", minHeight: 28 } },
            input: {
              startAdornment: <InputAdornment position="start"><QrCodeScanner /></InputAdornment>,
              endAdornment: cameraEnabled ? <InputAdornment position="end"><IconButton type="button" edge="end" aria-label="Scan barcode with camera" title="Scan barcode with camera" disabled={disabled || busy} onClick={() => { setCameraError(null); setCameraOpen(true); }}><CameraAlt /></IconButton></InputAdornment> : undefined,
            },
          }}
        />
      </Box>
      <Dialog open={cameraOpen} onClose={() => setCameraOpen(false)} fullWidth maxWidth="sm" aria-labelledby="camera-scan-title">
        <DialogTitle id="camera-scan-title" sx={{ display: "flex", alignItems: "center", gap: 1 }}><CameraAlt /> Camera barcode scanner</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5}>
            {cameraError && <Alert severity="warning">{cameraError}</Alert>}
            {!cameraError && <Alert severity="info">Point the rear camera at a single barcode and hold steady. Scanning closes automatically when a code is detected.</Alert>}
            <Box sx={{ position: "relative", overflow: "hidden", bgcolor: "#101820", borderRadius: 1, minHeight: 220, aspectRatio: "16 / 9", display: "grid", placeItems: "center" }}>
              <video ref={videoRef} muted playsInline autoPlay aria-label="Live camera preview" style={{ width: "100%", height: "100%", objectFit: "cover", position: "absolute", inset: 0 }} />
              {!cameraError && <Box sx={{ position: "absolute", inset: "25% 8%", border: "2px solid #F2A900", borderRadius: 1, pointerEvents: "none" }} />}
            </Box>
            <Box component="p" sx={{ m: 0, color: "text.secondary", fontSize: 13 }}>If camera scan is not supported on this device, close this window and use the scan field with a keyboard-wedge scanner or type the item/barcode manually.</Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button startIcon={<Close />} onClick={() => setCameraOpen(false)}>Close scanner</Button>
        </DialogActions>
      </Dialog>
    </>
  );
});
