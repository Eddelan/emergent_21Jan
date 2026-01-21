import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Upload, Play, Scissors, Sparkles, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

export default function HomePage() {
  const navigate = useNavigate();
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileUpload(file);
    }
  }, []);

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      handleFileUpload(file);
    }
  };

  const handleFileUpload = async (file) => {
    // Validate file type
    if (!file.type.startsWith("video/")) {
      toast.error("Please upload a video file");
      return;
    }

    // Check file size (500MB limit)
    if (file.size > 500 * 1024 * 1024) {
      toast.error("File too large. Maximum size is 500MB.");
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await axios.post(`${API}/videos/upload`, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
        onUploadProgress: (progressEvent) => {
          const progress = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total
          );
          setUploadProgress(progress);
        },
      });

      toast.success("Video uploaded! Processing started...");
      navigate(`/editor/${response.data.id}`);
    } catch (error) {
      console.error("Upload error:", error);
      toast.error(error.response?.data?.detail || "Failed to upload video");
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  return (
    <div className="min-h-screen bg-[#09090b] relative overflow-hidden" data-testid="home-page">
      {/* Hero glow background */}
      <div className="absolute inset-0 hero-glow pointer-events-none" />
      
      {/* Noise texture */}
      <div className="absolute inset-0 noise pointer-events-none" />

      <div className="relative z-10">
        {/* Header */}
        <header className="px-6 md:px-12 py-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Scissors className="w-6 h-6 text-violet-500" />
            <span className="font-heading font-semibold text-lg text-white">ClipForge</span>
          </div>
        </header>

        {/* Hero Section */}
        <main className="px-6 md:px-12 pt-12 md:pt-24 pb-24">
          <div className="max-w-4xl mx-auto">
            {/* Hero Text */}
            <div className="text-left mb-16 animate-fade-in">
              <h1 className="font-heading font-bold text-4xl sm:text-5xl lg:text-6xl text-white mb-6 leading-tight">
                Turn Talk into Content.
              </h1>
              <p className="text-base md:text-lg text-zinc-400 max-w-xl">
                Upload video. Select text. Generate clips. It&apos;s that simple.
              </p>
            </div>

            {/* Upload Zone */}
            <div
              className={`upload-zone border-2 border-dashed rounded-2xl p-12 flex flex-col items-center justify-center text-center cursor-pointer group ${
                isDragging
                  ? "active border-violet-500 bg-violet-500/10"
                  : "border-zinc-800 hover:border-violet-500/50"
              } ${isUploading ? "pointer-events-none" : ""}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => !isUploading && document.getElementById("file-input").click()}
              data-testid="upload-zone"
            >
              <input
                id="file-input"
                type="file"
                accept="video/*"
                className="hidden"
                onChange={handleFileSelect}
                disabled={isUploading}
                data-testid="file-input"
              />

              {isUploading ? (
                <div className="flex flex-col items-center gap-4">
                  <Loader2 className="w-12 h-12 text-violet-500 spinner" />
                  <div className="w-48 h-2 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-violet-500 progress-bar rounded-full"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <p className="text-zinc-400 font-mono text-sm">
                    Uploading... {uploadProgress}%
                  </p>
                </div>
              ) : (
                <>
                  <div className="w-16 h-16 rounded-full bg-zinc-900 flex items-center justify-center mb-6 group-hover:bg-violet-500/20 transition-colors">
                    <Upload className="w-8 h-8 text-zinc-500 group-hover:text-violet-400 transition-colors" />
                  </div>
                  <p className="text-white font-medium mb-2">
                    Drop your video here
                  </p>
                  <p className="text-zinc-500 text-sm mb-4">
                    or click to browse
                  </p>
                  <p className="text-zinc-600 text-xs font-mono">
                    MP4, MOV, AVI, WEBM • Max 500MB
                  </p>
                </>
              )}
            </div>

            {/* Features */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16">
              <FeatureCard
                icon={<Upload className="w-5 h-5" />}
                title="Upload"
                description="Drop any video file up to 25MB"
              />
              <FeatureCard
                icon={<Sparkles className="w-5 h-5" />}
                title="Transcribe"
                description="AI-powered speech recognition"
              />
              <FeatureCard
                icon={<Play className="w-5 h-5" />}
                title="Generate"
                description="Create clips from selected text"
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function FeatureCard({ icon, title, description }) {
  return (
    <div className="glass rounded-xl p-6 group hover:border-white/20 transition-colors animate-slide-in-right" data-testid={`feature-${title.toLowerCase()}`}>
      <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center text-violet-400 mb-4 group-hover:bg-violet-500/20 transition-colors">
        {icon}
      </div>
      <h3 className="font-heading font-semibold text-white mb-2">{title}</h3>
      <p className="text-zinc-500 text-sm">{description}</p>
    </div>
  );
}
