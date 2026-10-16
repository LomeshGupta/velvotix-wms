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
import InputAdornment from "@mui/material/InputAdornment";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { forwardRef, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { MONO } from "@/theme/theme";

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
 * Keyboard-wedge/manual scan input plus a cross-browser camera barcode reader.
 * ZXing is used instead of relying on BarcodeDetector because iOS Safari does not
 * consistently expose the native BarcodeDetector API. Camera permission is requested
 * only after the operator presses the explicit Start camera button.
 */
export const ScanInput = forwardRef<HTMLInputElement, Props>(function ScanInput(
  {
    onScan,
    disabled,
    busy,
    label = "Scan item barcode",
    helperText,
    error,
    cameraEnabled = true,
  },
  ref,
) {
  const [value, setValue] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraRunning, setCameraRunning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const onScanRef = useRef(onScan);
  const scannerControlsRef = useRef<{ stop: () => void } | null>(null);
  const cameraOpenRef = useRef(false);
  const scanHandledRef = useRef(false);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const stopCamera = useCallback(() => {
    try {
      scannerControlsRef.current?.stop();
    } catch {
      // Continue closing the camera even if the decoder has already stopped.
    }
    scannerControlsRef.current = null;

    const video = videoRef.current;
    const stream = video?.srcObject;
    if (stream && typeof (stream as MediaStream).getTracks === "function") {
      (stream as MediaStream).getTracks().forEach((track) => track.stop());
    }
    if (video) {
      video.pause();
      video.srcObject = null;
    }
  }, []);

  const closeCamera = useCallback(() => {
    cameraOpenRef.current = false;
    stopCamera();
    setCameraStarting(false);
    setCameraRunning(false);
    setCameraOpen(false);
  }, [stopCamera]);

  const handleDetected = useCallback((rawCode: string) => {
    const code = rawCode.trim();
    if (!code || scanHandledRef.current) return;
    scanHandledRef.current = true;
    closeCamera();
    setValue("");
    onScanRef.current(code);
  }, [closeCamera]);

  useEffect(() => () => {
    cameraOpenRef.current = false;
    stopCamera();
  }, [stopCamera]);

  const openCamera = () => {
    setCameraError(null);
    scanHandledRef.current = false;
    cameraOpenRef.current = true;
    setCameraOpen(true);
  };

  const startCamera = async () => {
    setCameraError(null);
    setCameraStarting(true);
    scanHandledRef.current = false;

    const video = videoRef.current;
    if (!video) {
      setCameraStarting(false);
      setCameraError("Camera preview is not ready. Close this window and try again.");
      return;
    }

    if (!window.isSecureContext) {
      setCameraStarting(false);
      setCameraError("Camera scanning needs a secure HTTPS website. Open the WMS using its HTTPS address, then try again.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStarting(false);
      setCameraError("This browser cannot open the camera. Use the WMS in updated Safari over HTTPS, or use a Bluetooth scanner or enter the barcode.");
      return;
    }

    try {
      // This call starts from the operator's button tap so Safari can present its camera prompt.
      await new BrowserMultiFormatReader().decodeFromConstraints(
        {
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        },
        video,
        (result, _decodeError, controls) => {
          if (controls && !scannerControlsRef.current) {
            scannerControlsRef.current = controls;
            if (!cameraOpenRef.current) controls.stop();
            else {
              setCameraRunning(true);
              setCameraStarting(false);
            }
          }
          if (!cameraOpenRef.current) {
            controls?.stop();
            return;
          }
          if (result) handleDetected(result.getText());
        },
      );
    } catch (e) {
      const err = e as { name?: string; message?: string };
      if (!cameraOpenRef.current) return;
      if (err.name === "NotAllowedError" || err.name === "SecurityError") {
        setCameraError("Camera permission is blocked. On iPhone, open Settings → Safari → Camera and allow access for this website. Then reload the WMS and try again.");
      } else if (err.name === "NotFoundError" || err.name === "OverconstrainedError") {
        setCameraError("No usable camera was found. Check the iPhone camera and try again, or use a Bluetooth scanner.");
      } else if (err.name === "NotReadableError" || err.name === "AbortError") {
        setCameraError("The camera is busy. Close the Camera app and any other app using the camera, then try again.");
      } else {
        setCameraError("Could not start scanning. Allow camera access in Safari, make sure the website uses HTTPS, and try again.");
      }
      stopCamera();
      setCameraRunning(false);
    } finally {
      if (cameraOpenRef.current) setCameraStarting(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const code = value.trim();
    if (!code || disabled || busy) return;
    onScanRef.current(code);
    setValue("");
  };

  return (
    <>
      <Box component="form" onSubmit={submit} sx={{ width: "100%" }}>
        <Stack direction={{ xs: "column", xl: "row" }} spacing={1} alignItems="stretch">
          <TextField
            fullWidth
            size="medium"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputRef={ref}
            disabled={disabled || busy}
            error={error}
            label={label}
            placeholder="Scan or type code"
            helperText={helperText ?? "Point a scanner at the barcode, or type the code."}
            autoComplete="off"
            slotProps={{
              htmlInput: {
                inputMode: "text",
                enterKeyHint: "done",
                autoCapitalize: "characters",
                spellCheck: false,
                "aria-label": label,
                style: { fontFamily: MONO, fontSize: "1.25rem", minHeight: 36 },
              },
              input: {
                startAdornment: <InputAdornment position="start"><QrCodeScanner /></InputAdornment>,
              },
            }}
            sx={{ "& .MuiInputBase-root": { minHeight: 64 } }}
          />
          {cameraEnabled && (
            <Button
              type="button"
              fullWidth
              variant="contained"
              color="secondary"
              startIcon={<CameraAlt />}
              disabled={disabled || busy}
              onClick={openCamera}
              sx={{ minWidth: { sm: 180 }, minHeight: 64, color: "secondary.contrastText", fontSize: "1rem", fontWeight: 800 }}
            >
              Scan with camera
            </Button>
          )}
          <Button type="submit" variant="outlined" disabled={disabled || busy || !value.trim()} sx={{ minHeight: 64, minWidth: { sm: 112 } }}>
            Use code
          </Button>
        </Stack>
      </Box>

      <Dialog
        open={cameraOpen}
        onClose={closeCamera}
        fullWidth
        maxWidth="sm"
        aria-labelledby="camera-scan-title"
        PaperProps={{ sx: { mx: { xs: 1, sm: 2 }, width: { xs: "calc(100% - 16px)", sm: "100%" } } }}
      >
        <DialogTitle id="camera-scan-title" sx={{ display: "flex", alignItems: "center", gap: 1, pb: 1 }}>
          <CameraAlt color="primary" />
          <Box>
            <Typography component="span" variant="h2">Scan barcode</Typography>
            <Typography display="block" variant="body2" color="text.secondary">Use the back camera of the iPhone or iPad.</Typography>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={1.5}>
            {cameraError ? (
              <Alert severity="warning" role="alert">{cameraError}</Alert>
            ) : (
              <Alert severity="info" icon={<QrCodeScanner />}>
                Tap <strong>Start camera</strong>, allow camera access, then hold one barcode inside the frame.
              </Alert>
            )}
            <Box sx={{ position: "relative", overflow: "hidden", bgcolor: "#101820", borderRadius: 2, minHeight: 250, aspectRatio: "4 / 3", display: "grid", placeItems: "center" }}>
              <video
                ref={videoRef}
                muted
                playsInline
                autoPlay
                aria-label="Live camera preview"
                style={{ width: "100%", height: "100%", objectFit: "cover", position: "absolute", inset: 0 }}
              />
              {!cameraError && <Box sx={{ position: "absolute", inset: "25% 7%", border: "3px solid #F2A900", borderRadius: 2, boxShadow: "0 0 0 999px rgba(0,0,0,.13)", pointerEvents: "none" }} />}
              {!cameraStarting && !cameraRunning && !cameraError && (
                <Typography sx={{ position: "relative", px: 2, py: 1, bgcolor: "rgba(0,0,0,.65)", color: "#fff", borderRadius: 1, fontWeight: 700 }}>
                  Camera is ready to start
                </Typography>
              )}
            </Box>
            <Button
              variant="contained"
              size="large"
              startIcon={<CameraAlt />}
              disabled={cameraStarting || cameraRunning}
              onClick={() => void startCamera()}
              sx={{ minHeight: 56, fontSize: "1.05rem" }}
            >
              {cameraStarting ? "Starting camera…" : cameraRunning ? "Scanning… hold barcode in frame" : cameraError ? "Try camera again" : "Start camera"}
            </Button>
            <Typography variant="body2" color="text.secondary">
              If scanning still does not work, close this window and use a Bluetooth barcode scanner or type the code. The camera requires HTTPS and permission in Safari.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 2, pb: 2 }}>
          <Button startIcon={<Close />} onClick={closeCamera} sx={{ minHeight: 48 }}>Close scanner</Button>
        </DialogActions>
      </Dialog>
    </>
  );
});
