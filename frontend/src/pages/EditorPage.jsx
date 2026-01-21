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
  const [selectedWords, setSelectedWords] = useState(new Set()); // Store word IDs
  const [selectionStart, setSelectionStart] = useState(null); // For range selection
  const [generatingClip, setGeneratingClip] = useState(false);
  const [currentClip, setCurrentClip] = useState(null);

  // Flatten all words from segments
  const getAllWords = useCallback(() => {
    if (!video?.transcript) return [];
    const words = [];
    let globalIdx = 0;
    video.transcript.forEach((segment) => {
      if (segment.words && segment.words.length > 0) {
        segment.words.forEach((word) => {
          words.push({
            ...word,
            globalId: globalIdx++,
            segmentId: segment.id,
          });
        });
      }
    });
    return words;
  }, [video]);

  // Fetch video data
  const fetchVideo = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/videos/${videoId}`);
      setVideo(response.data);
      setLoading(false);

      if (
        response.data.status === "uploading" ||
        response.data.status === "processing" ||
        response.data.status === "transcribing"
      ) {
        if (!pollInterval.current) {
          pollInterval.current = setInterval(fetchVideo, 2000);
        }
      } else {
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

  // Word selection with shift-click for range
  const handleWordClick = (word, event) => {
    const allWords = getAllWords();
    
    if (event.shiftKey && selectionStart !== null) {
      // Range selection
      const startIdx = Math.min(selectionStart, word.globalId);
      const endIdx = Math.max(selectionStart, word.globalId);
      
      const newSelection = new Set(selectedWords);
      for (let i = startIdx; i <= endIdx; i++) {
        newSelection.add(i);
      }
      setSelectedWords(newSelection);
    } else {
      // Single word toggle
      setSelectedWords((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(word.globalId)) {
          newSet.delete(word.globalId);
        } else {
          newSet.add(word.globalId);
        }
        return newSet;
      });
      setSelectionStart(word.globalId);
    }
  };

  // Select all words
  const selectAll = () => {
    const allWords = getAllWords();
    setSelectedWords(new Set(allWords.map((w) => w.globalId)));
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedWords(new Set());
    setSelectionStart(null);
  };

  // Jump to word in video
  const jumpToWord = (word) => {
    if (videoRef.current) {
      videoRef.current.currentTime = word.start;
      if (!isPlaying) {
        videoRef.current.play();
        setIsPlaying(true);
      }
    }
  };

  // Get selected time ranges from words
  const getSelectedTimeRanges = () => {
    const allWords = getAllWords();
    const selectedWordsList = allWords
      .filter((w) => selectedWords.has(w.globalId))
      .sort((a, b) => a.start - b.start);

    if (selectedWordsList.length === 0) return [];

    // Merge consecutive words into ranges
    const ranges = [];
    let currentRange = {
      start: selectedWordsList[0].start,
      end: selectedWordsList[0].end,
    };

    for (let i = 1; i < selectedWordsList.length; i++) {
      const word = selectedWordsList[i];
      // If words are close together (within 0.5s), merge them
      if (word.start - currentRange.end < 0.5) {
        currentRange.end = word.end;
      } else {
        ranges.push(currentRange);
        currentRange = { start: word.start, end: word.end };
      }
    }
    ranges.push(currentRange);

    return ranges;
  };

  // Generate clip
  const generateClip = async () => {
    const segments = getSelectedTimeRanges();
    
    if (segments.length === 0) {
      toast.error("Please select at least one word");
      return;
    }

    setGeneratingClip(true);
    setCurrentClip(null);

    try {
      const response = await axios.post(
        `${API}/videos/${videoId}/generate-clip`,
        { segments }
      );

      const clipId = response.data.id;
      toast.success("Generating clip...");

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

  // Check if word is currently playing
  const isWordCurrent = (word) => {
    return currentTime >= word.start && currentTime < word.end;
  };

  // Check if transcript has words
  const hasWords = () => {
    if (!video?.transcript) return false;
    return video.transcript.some((seg) => seg.words && seg.words.length > 0);
  };

  const allWords = getAllWords();

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
            {allWords.length > 0 && (
              <span className="text-xs text-zinc-500 font-mono">
                {selectedWords.size} / {allWords.length} words
              </span>
            )}
          </div>
          {allWords.length > 0 && (
            <div className="flex gap-2 flex-wrap">
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
          <p className="text-xs text-zinc-600 mt-2">
            Click words to select. Shift+click for range selection.
          </p>
        </div>

        {/* Transcript Content */}
        <ScrollArea className="flex-1" data-testid="transcript-area">
          <div className="p-4">
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
            ) : hasWords() ? (
              <div className="space-y-4">
                {video.transcript.map((segment) => (
                  <div key={segment.id} className="space-y-1">
                    <button
                      onClick={() => {
                        if (videoRef.current) {
                          videoRef.current.currentTime = segment.start;
                        }
                      }}
                      className="text-xs font-mono text-zinc-600 hover:text-teal-400 transition-colors"
                    >
                      {formatTime(segment.start)}
                    </button>
                    <div className="flex flex-wrap gap-1 leading-relaxed">
                      {segment.words?.map((word) => {
                        const globalWord = allWords.find(
                          (w) => w.start === word.start && w.word === word.word
                        );
                        const globalId = globalWord?.globalId ?? -1;
                        const isSelected = selectedWords.has(globalId);
                        const isCurrent = isWordCurrent(word);

                        return (
                          <span
                            key={`${segment.id}-${word.id}`}
                            onClick={(e) => handleWordClick({ ...word, globalId }, e)}
                            onDoubleClick={() => jumpToWord(word)}
                            className={`
                              px-1 py-0.5 rounded cursor-pointer transition-colors select-none
                              ${isSelected 
                                ? "bg-teal-500/30 text-teal-200 ring-1 ring-teal-500/50" 
                                : "hover:bg-white/10 text-zinc-300"
                              }
                              ${isCurrent ? "bg-violet-500/30 ring-1 ring-violet-500/50" : ""}
                            `}
                            data-testid={`word-${globalId}`}
                            title={`${formatTime(word.start)} - ${formatTime(word.end)}`}
                          >
                            {word.word}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : video.transcript && video.transcript.length > 0 ? (
              // Fallback to segment-level display if no words
              <div className="space-y-2">
                {video.transcript.map((segment) => (
                  <div
                    key={segment.id}
                    className="p-3 rounded-lg hover:bg-white/5 cursor-pointer"
                    onClick={() => {
                      if (videoRef.current) {
                        videoRef.current.currentTime = segment.start;
                      }
                    }}
                  >
                    <span className="text-xs font-mono text-zinc-600 block mb-1">
                      {formatTime(segment.start)}
                    </span>
                    <p className="text-sm text-zinc-300">{segment.text}</p>
                  </div>
                ))}
                <p className="text-xs text-zinc-600 text-center mt-4">
                  Word-level selection not available for this video.
                </p>
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="text-zinc-500 text-sm">No transcript available</p>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Generate Button */}
        {video.status === "ready" && (hasWords() || (video.transcript && video.transcript.length > 0)) && (
          <div className="p-4 border-t border-white/5 space-y-3">
            {selectedWords.size > 0 && (
              <div className="text-xs text-zinc-500 mb-2">
                Selected duration: ~{getSelectedTimeRanges().reduce((acc, r) => acc + (r.end - r.start), 0).toFixed(1)}s
              </div>
            )}
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
              disabled={selectedWords.size === 0 || generatingClip}
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
                  Generate Clip ({selectedWords.size} words)
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
