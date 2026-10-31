"use client"

import React, { useState, useRef, useEffect, useCallback } from "react"
import { API_BASE_URL } from "@/lib/api"
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  AlertCircle,
  Clock,
  Sparkles,
  Download,
  Shield,
  X,
  RefreshCw,
} from "lucide-react"

/**
 * Format seconds into mm:ss display
 */
function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0 || !isFinite(seconds)) return "0:00"
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`
}

/**
 * InBrowserAudioPlayer
 * Roadmap Phase 19: Embedded authenticated GridFS audio streaming playback with seeking.
 * Supports converted MP3 streaming, HTTP Range requests, seeking, volume, speed, and manual download.
 */
export default function InBrowserAudioPlayer({
  callId,
  recording = {},
  agentName = "Agent",
  leadPhone = "",
  direction = "outbound",
  onClose = null,
  compact = false,
}) {
  const audioRef = useRef(null)
  const blobUrlRef = useRef(null)
  const abortControllerRef = useRef(null)

  const initialDuration = recording?.duration || recording?.durationSeconds || 0
  const [blobUrl, setBlobUrl] = useState(null)
  const [streamSrc, setStreamSrc] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(initialDuration)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)

  // Keep duration synced if recording prop updates
  useEffect(() => {
    const known = recording?.duration || recording?.durationSeconds || 0
    if (known > 0) {
      setDuration(known)
    }
  }, [callId, recording?.duration, recording?.durationSeconds])

  // 1. Authenticated audio fetch into local managed Blob URL
  useEffect(() => {
    setIsLoading(true)
    setError(null)
    setIsPlaying(false)
    setCurrentTime(0)

    const initialKnown = recording?.duration || recording?.durationSeconds || 0
    if (initialKnown > 0) {
      setDuration(initialKnown)
    } else {
      setDuration(0)
    }

    // Abort previous in-flight request if user switches calls
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    const controller = new AbortController()
    abortControllerRef.current = controller

    // Clean up previous blob URL to prevent memory leaks
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current)
      blobUrlRef.current = null
      setBlobUrl(null)
    }

    if (!callId) {
      setIsLoading(false)
      setError("No recording identifier provided.")
      return
    }

    let token = null
    if (typeof window !== "undefined") {
      try {
        token = localStorage.getItem("leadflow_token")
      } catch (_) {}
    }

    // Instant Direct Streaming (0ms latency without waiting for full blob download)
    const directUrl = `${API_BASE_URL}/calls/${callId}/recording?format=mp3${token ? `&token=${encodeURIComponent(token)}` : ""}`
    setStreamSrc(directUrl)

    return () => {
      controller.abort()
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }
    }
  }, [callId])

  // 2. Audio DOM event handlers with Instant Auto-play & Error Diagnostics
  useEffect(() => {
    const audio = audioRef.current
    const activeSrc = streamSrc || blobUrl
    if (!audio || !activeSrc) return

    const handleLoadedMetadata = () => {
      if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration)
      }
      setIsLoading(false)
    }

    const handleCanPlay = () => {
      setIsLoading(false)
      audio.play().then(() => {
        setIsPlaying(true)
        setError(null)
      }).catch((e) => {
        if (e.name !== "AbortError") {
          setIsPlaying(false)
        }
      })
    }

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime || 0)
    }

    const handleEnded = () => {
      setIsPlaying(false)
      setCurrentTime(0)
    }

    const handleError = async () => {
      setIsLoading(false)
      setIsPlaying(false)
      try {
        let token = null
        if (typeof window !== "undefined") {
          try { token = localStorage.getItem("leadflow_token") } catch (_) {}
        }
        const checkRes = await fetch(`${API_BASE_URL}/calls/${callId}/recording?format=mp3`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (!checkRes.ok) {
          const errData = await checkRes.json().catch(() => ({}))
          setError(errData.error || (checkRes.status === 404 ? "Recording audio not found on server." : "Unable to stream audio recording."))
          return
        }
      } catch (_) {}
      setError("Audio stream playback failed. Please verify credentials or compliance eligibility.")
    }

    audio.addEventListener("loadedmetadata", handleLoadedMetadata)
    audio.addEventListener("canplay", handleCanPlay)
    audio.addEventListener("timeupdate", handleTimeUpdate)
    audio.addEventListener("ended", handleEnded)
    audio.addEventListener("error", handleError)

    return () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata)
      audio.removeEventListener("canplay", handleCanPlay)
      audio.removeEventListener("timeupdate", handleTimeUpdate)
      audio.removeEventListener("ended", handleEnded)
      audio.removeEventListener("error", handleError)
      audio.pause()
    }
  }, [streamSrc, blobUrl, callId])

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return

    if (isPlaying) {
      audio.pause()
      setIsPlaying(false)
    } else {
      // Pause any other playing audio on the page to prevent duplicate playback
      document.querySelectorAll("audio").forEach((el) => {
        if (el !== audio) {
          el.pause()
        }
      })

      audio
        .play()
        .then(() => {
          setIsPlaying(true)
          setError(null)
        })
        .catch((err) => {
          if (err.name !== "AbortError") {
            console.error("Playback start error:", err)
            setError("Audio stream playback failed. Please verify credentials or compliance eligibility.")
          }
        })
    }
  }

  const handleSeek = (e) => {
    const newTime = parseFloat(e.target.value)
    setCurrentTime(newTime)
    if (audioRef.current) {
      audioRef.current.currentTime = newTime
    }
  }

  const handleSkipBack = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 10)
    }
  }

  const cycleSpeed = () => {
    const speeds = [1, 1.25, 1.5, 2]
    const nextIdx = (speeds.indexOf(playbackRate) + 1) % speeds.length
    const nextRate = speeds[nextIdx]
    setPlaybackRate(nextRate)
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate
    }
  }

  const toggleMute = () => {
    if (audioRef.current) {
      audioRef.current.muted = !isMuted
      setIsMuted(!isMuted)
    }
  }

  const handleManualDownload = () => {
    if (!blobUrl) return
    const a = document.createElement("a")
    a.href = blobUrl
    a.download = `recording_${callId}.mp3`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  // Calculate genuine days until expiration when expiresAt is populated
  const expiryDate = recording?.expiresAt ? new Date(recording.expiresAt) : null
  const hasValidExpiry = expiryDate && !isNaN(expiryDate.getTime())
  const daysUntilExpiry = hasValidExpiry
    ? Math.max(0, Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24)))
    : null

  return (
    <div
      className={`rounded-2xl transition-all duration-200 border ${
        compact
          ? "bg-slate-900 text-white p-3 border-slate-800 shadow-md"
          : "bg-slate-900/95 backdrop-blur-md text-white p-4 border-slate-800 shadow-xl"
      }`}
    >
      <audio
        ref={audioRef}
        src={streamSrc || blobUrl || undefined}
        preload="metadata"
      />

      {/* Header Info */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center space-x-2">
          <div className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-400">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="text-xs font-semibold text-white flex items-center gap-1.5">
              <span>Recording: {leadPhone || "Lead Call"}</span>
              <span className="text-[10px] text-slate-400 font-mono">({agentName})</span>
            </div>
            <div className="text-[10px] text-slate-400 flex items-center gap-2">
              <span className="capitalize">{direction} Call</span>
              {daysUntilExpiry !== null ? (
                <>
                  <span>•</span>
                  <span className="text-amber-400">Retained {daysUntilExpiry}d remaining</span>
                </>
              ) : recording?.status === "stored" ? (
                <>
                  <span>•</span>
                  <span className="text-emerald-400">Retained (Policy: 30d)</span>
                </>
              ) : recording?.status === "ready" ? (
                <>
                  <span>•</span>
                  <span className="text-slate-400">Legacy Recording</span>
                </>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-1">
          {blobUrl && (
            <button
              type="button"
              onClick={handleManualDownload}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              title="Download MP3 recording"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              title="Close player"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="my-2 p-2.5 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Waveform / Progress Slider */}
      <div className="space-y-1 my-2">
        <input
          type="range"
          min={0}
          max={duration || 100}
          step={0.1}
          value={currentTime}
          onChange={handleSeek}
          disabled={isLoading || Boolean(error)}
          className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500 disabled:opacity-40"
        />
        <div className="flex justify-between text-[10px] font-mono text-slate-400">
          <span>{formatTime(currentTime)}</span>
          <span>{isLoading && duration === 0 ? "--:--" : formatTime(duration)}</span>
        </div>
      </div>

      {/* Player Controls Bar */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={handleSkipBack}
            disabled={isLoading || Boolean(error)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition disabled:opacity-40"
            title="Rewind 10 seconds"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={togglePlay}
            disabled={isLoading && !error}
            className="p-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition shadow-sm flex items-center justify-center disabled:opacity-50 cursor-pointer"
            title={isPlaying ? "Pause" : "Play Recording"}
          >
            {isLoading && !error ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-4 h-4 fill-current" />
            ) : (
              <Play className="w-4 h-4 fill-current ml-0.5" />
            )}
          </button>

          <button
            type="button"
            onClick={cycleSpeed}
            className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-bold font-mono transition"
            title="Playback Speed"
          >
            {playbackRate}x
          </button>
        </div>

        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={toggleMute}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? <VolumeX className="w-3.5 h-3.5 text-rose-400" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  )
}
