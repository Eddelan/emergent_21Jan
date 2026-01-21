# ClipForge - Video Transcript Clip Generator

## Original Problem Statement
Create a web application where users can upload an MP4 video. Use OpenAI Whisper to generate a transcript of the uploaded video. Display the transcript to the user. Allow users to select parts of the transcript and click a "generate" button to create a new video that includes only the selected parts of the transcript.

## Architecture
- **Backend**: FastAPI (Python)
- **Frontend**: React with Tailwind CSS
- **Database**: MongoDB
- **AI**: OpenAI Whisper (via Emergent LLM Key)
- **Video Processing**: FFmpeg

## User Personas
1. **Content Creator**: Wants to quickly create short clips from longer videos for social media
2. **Video Editor**: Needs to extract specific segments from interviews or presentations
3. **Social Media Manager**: Requires quick turnaround for video clip creation

## Core Requirements (Static)
- [x] Video upload (MP4, MOV, AVI, WEBM)
- [x] File size limit: 25MB
- [x] AI-powered transcription with timestamps
- [x] Selectable transcript segments
- [x] Video clip generation from selected segments
- [x] Video playback with progress bar
- [x] Clip download functionality

## What's Been Implemented (December 2025)
### Backend
- Video upload endpoint with validation
- Audio extraction using FFmpeg
- Transcription via OpenAI Whisper (Emergent LLM Key)
- Video streaming with range request support
- Clip generation with FFmpeg concatenation
- Clip download endpoint

### Frontend
- Home page with drag-drop upload zone
- Editor page with split-panel layout
- Video player with play/pause controls
- Transcript viewer with selectable segments
- Select All / Clear selection controls
- Generate Clip button with loading state
- Download Clip button
- Dark "Cinematic" theme design

## Prioritized Backlog
### P0 (Critical)
- All core features implemented ✓

### P1 (Important)
- Multi-file segment selection across different timestamps
- Video preview before download
- Progress indicator for long video processing

### P2 (Nice to Have)
- User authentication
- Video history / saved projects
- Export to multiple formats
- Custom video trimming (manual time selection)
- Subtitle/caption export (SRT, VTT)

## Next Tasks
1. Add video preview for generated clips before download
2. Implement processing progress indicator with percentage
3. Add support for larger files (chunk upload)
4. Add user authentication for saved projects
