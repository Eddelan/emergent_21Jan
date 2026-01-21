import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Play,
  Pause,
  Scissors,
  Download,
  Loader2,
  Check,
  X,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export default function EditorPage() {
  const { videoId } = useParams();
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const pollInterval = useRef(null);

  const [video, setVideo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [selectedSegments, setSelectedSegments] = useState(new Set());
  const [generatingClip, setGeneratingClip] = useState(false);
  const [currentClip, setCurrentClip] = useState(null);

  // Fetch video data
  const fetchVideo = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/videos/${videoId}`);
      setVideo(response.data);
      setLoading(false);

      // Check if still processing
      if (
        response.data.status === "uploading" ||
        response.data.status === "processing" ||
        response.data.status === "transcribing"
      ) {
        // Continue polling
        if (!pollInterval.current) {
          pollInterval.current = setInterval(fetchVideo, 2000);
        }
      } else {
        // Stop polling
        if (pollInterval.current) {
          clearInterval(pollInterval.current);
          pollInterval.current = null;
        }
      }
    } catch (error) {
      console.error("Error fetching video:", error);
      toast.error("Failed to load video");
      setLoading(false);
    }
  }, [videoId]);

  useEffect(() => {
    fetchVideo();
    return () => {
      if (pollInterval.current) {
        clearInterval(pollInterval.current);
      }
    };
  }, [fetchVideo]);

  // Video controls
  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleVideoEnded = () => {
    setIsPlaying(false);
  };

  // Segment selection
  const toggleSegment = (segmentId) => {
    setSelectedSegments((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(segmentId)) {
        newSet.delete(segmentId);
      } else {
        newSet.add(segmentId);
      }
      return newSet;
    });
  };

  const selectAll = () => {
    if (video?.transcript) {
      setSelectedSegments(new Set(video.transcript.map((s) => s.id)));
    }
  };

  const clearSelection = () => {
    setSelectedSegments(new Set());
  };

  // Jump to segment in video
  const jumpToSegment = (segment) => {
    if (videoRef.current) {
      videoRef.current.currentTime = segment.start;
      if (!isPlaying) {
        videoRef.current.play();
        setIsPlaying(true);
      }
    }
  };

  // Generate clip
  const generateClip = async () => {
    if (selectedSegments.size === 0) {
      toast.error("Please select at least one segment");
      return;
    }

    setGeneratingClip(true);
    setCurrentClip(null);

    const segments = video.transcript
      .filter((s) => selectedSegments.has(s.id))
      .map((s) => ({ start: s.start, end: s.end }));

    try {
      const response = await axios.post(
        `${API}/videos/${videoId}/generate-clip`,
        { segments }
      );

      const clipId = response.data.id;
      toast.success("Generating clip...");

      // Poll for clip status
      const checkClip = async () => {
        try {
          const clipResponse = await axios.get(`${API}/clips/${clipId}`);
          setCurrentClip(clipResponse.data);

          if (clipResponse.data.status === "ready") {
            setGeneratingClip(false);
            toast.success("Clip ready for download!");
          } else if (clipResponse.data.status === "error") {
            setGeneratingClip(false);
            toast.error(clipResponse.data.error_message || "Failed to generate clip");
          } else {
            // Still processing, check again
            setTimeout(checkClip, 1500);
          }
        } catch (error) {
          console.error("Error checking clip:", error);
          setGeneratingClip(false);
          toast.error("Failed to check clip status");
        }
      };

      checkClip();
    } catch (error) {
      console.error("Error generating clip:", error);
      toast.error(error.response?.data?.detail || "Failed to generate clip");
      setGeneratingClip(false);
    }
  };

  // Download clip
  const downloadClip = () => {
    if (currentClip?.status === "ready") {
      window.open(`${API}/clips/${currentClip.id}/download`, "_blank");
    }
  };

  // Format time
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Get current segment
  const getCurrentSegmentId = () => {
    if (!video?.transcript) return null;
    for (const segment of video.transcript) {
      if (currentTime >= segment.start && currentTime < segment.end) {
        return segment.id;
      }
    }
    return null;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center" data-testid="loading-screen">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-violet-500 spinner" />
          <p className="text-zinc-400">Loading video...</p>
        </div>
      </div>
    );
  }

  if (!video) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center" data-testid="error-screen">
        <div className="text-center">
          <p className="text-zinc-400 mb-4">Video not found</p>
          <Button onClick={() => navigate("/")} variant="outline">
            Go Back
          </Button>
        </div>
      </div>
    );
  }

  const isProcessing =
    video.status === "uploading" ||
    video.status === "processing" ||
    video.status === "transcribing";

  const currentSegmentId = getCurrentSegmentId();

  return (
    <div className="h-screen flex flex-col lg:flex-row overflow-hidden bg-[#09090b]" data-testid="editor-page">
      {/* Left Panel - Video Player */}
      <div className="w-full lg:w-2/3 bg-black flex flex-col">
        {/* Header */}
        <div className="p-4 flex items-center justify-between border-b border-white/5">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors"
            data-testid="back-button"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">Back</span>
          </button>
          <span className="text-sm text-zinc-500 font-mono truncate max-w-[200px]">
            {video.original_filename}
          </span>
        </div>

        {/* Video */}
        <div className="flex-1 flex items-center justify-center p-4 relative">
          {isProcessing ? (
            <div className="flex flex-col items-center gap-4" data-testid="processing-status">
              <Loader2 className="w-12 h-12 text-violet-500 spinner" />
              <p className="text-zinc-400 font-medium capitalize">
                {video.status === "transcribing"
                  ? "Transcribing audio..."
                  : video.status === "processing"
                  ? "Processing video..."
                  : "Uploading..."}
              </p>
              <p className="text-zinc-600 text-sm">This may take a minute</p>
            </div>
          ) : video.status === "error" ? (
            <div className="flex flex-col items-center gap-4 text-center" data-testid="error-status">
              <X className="w-12 h-12 text-red-500" />
              <p className="text-red-400 font-medium">Processing failed</p>
              <p className="text-zinc-500 text-sm max-w-md">
                {video.error_message || "An error occurred while processing your video"}
              </p>
              <Button onClick={() => navigate("/")} variant="outline">
                Try Again
              </Button>
            </div>
          ) : (
            <video
              ref={videoRef}
              src={`${API}/videos/${videoId}/stream`}
              className="max-w-full max-h-full rounded-lg"
              onTimeUpdate={handleTimeUpdate}
              onEnded={handleVideoEnded}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              data-testid="video-player"
            />
          )}
        </div>

        {/* Video Controls */}
        {!isProcessing && video.status === "ready" && (
          <div className="p-4 border-t border-white/5">
            <div className="flex items-center gap-4">
              <button
                onClick={togglePlay}
                className="w-10 h-10 rounded-full bg-violet-500 hover:bg-violet-600 flex items-center justify-center text-white transition-colors"
                data-testid="play-pause-button"
              >
                {isPlaying ? (
                  <Pause className="w-5 h-5" />
                ) : (
                  <Play className="w-5 h-5 ml-0.5" />
                )}
              </button>
              <div className="flex-1">
                <Progress
                  value={(currentTime / (video.duration || 1)) * 100}
                  className="h-1"
                  data-testid="video-progress"
                />
              </div>
              <span className="text-zinc-400 text-sm font-mono min-w-[80px] text-right">
                {formatTime(currentTime)} / {formatTime(video.duration || 0)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Right Panel - Transcript */}
      <div className="w-full lg:w-1/3 border-l border-white/5 bg-zinc-900/30 flex flex-col">
        {/* Transcript Header */}
        <div className="p-4 border-b border-white/5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-heading font-semibold text-white">Transcript</h2>
            {video.transcript && video.transcript.length > 0 && (
              <span className="text-xs text-zinc-500 font-mono">
                {selectedSegments.size} / {video.transcript.length} selected
              </span>
            )}
          </div>
          {video.transcript && video.transcript.length > 0 && (
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={selectAll}
                className="text-xs"
                data-testid="select-all-button"
              >
                Select All
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearSelection}
                className="text-xs"
                data-testid="clear-selection-button"
              >
                Clear
              </Button>
            </div>
          )}
        </div>

        {/* Transcript Content */}
        <ScrollArea className="flex-1" data-testid="transcript-area">
          <div className="p-4 space-y-1">
            {isProcessing ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Loader2 className="w-6 h-6 text-violet-500 spinner mb-3" />
                <p className="text-zinc-500 text-sm">
                  Generating transcript...
                </p>
              </div>
            ) : video.status === "error" ? (
              <div className="text-center py-12">
                <p className="text-zinc-500 text-sm">
                  Transcript unavailable
                </p>
              </div>
            ) : video.transcript && video.transcript.length > 0 ? (
              video.transcript.map((segment) => (
                <TranscriptSegment
                  key={segment.id}
                  segment={segment}
                  isSelected={selectedSegments.has(segment.id)}
                  isCurrent={currentSegmentId === segment.id}
                  onToggle={() => toggleSegment(segment.id)}
                  onJump={() => jumpToSegment(segment)}
                />
              ))
            ) : (
              <div className="text-center py-12">
                <p className="text-zinc-500 text-sm">No transcript available</p>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Generate Button */}
        {video.status === "ready" && video.transcript && video.transcript.length > 0 && (
          <div className="p-4 border-t border-white/5 space-y-3">
            {currentClip?.status === "ready" && (
              <Button
                onClick={downloadClip}
                variant="outline"
                className="w-full"
                data-testid="download-clip-button"
              >
                <Download className="w-4 h-4 mr-2" />
                Download Clip
              </Button>
            )}
            <Button
              onClick={generateClip}
              disabled={selectedSegments.size === 0 || generatingClip}
              className="w-full bg-violet-500 hover:bg-violet-600 text-white btn-glow"
              data-testid="generate-clip-button"
            >
              {generatingClip ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 spinner" />
                  Generating...
                </>
              ) : (
                <>
                  <Scissors className="w-4 h-4 mr-2" />
                  Generate Clip ({selectedSegments.size} segments)
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function TranscriptSegment({ segment, isSelected, isCurrent, onToggle, onJump }) {
  const formatTimestamp = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div
      className={`transcript-segment rounded-lg p-3 cursor-pointer group ${
        isSelected ? "selected bg-teal-500/10 border-l-2 border-teal-500" : ""
      } ${isCurrent ? "bg-violet-500/10" : ""}`}
      onClick={onToggle}
      data-testid={`transcript-segment-${segment.id}`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          <div
            className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
              isSelected
                ? "bg-teal-500 border-teal-500"
                : "border-zinc-600 group-hover:border-zinc-400"
            }`}
          >
            {isSelected && <Check className="w-3 h-3 text-black" />}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onJump();
            }}
            className="text-xs font-mono text-zinc-500 hover:text-teal-400 transition-colors mb-1"
          >
            {formatTimestamp(segment.start)}
          </button>
          <p
            className={`text-sm leading-relaxed ${
              isSelected ? "text-teal-200" : "text-zinc-300"
            }`}
          >
            {segment.text}
          </p>
        </div>
      </div>
    </div>
  );
}
