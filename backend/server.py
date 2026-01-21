from fastapi import FastAPI, APIRouter, UploadFile, File, HTTPException, BackgroundTasks, Request, Header
from fastapi.responses import FileResponse, StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
import uuid
from datetime import datetime, timezone
import aiofiles
import subprocess
import asyncio
from emergentintegrations.llm.openai import OpenAISpeechToText

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create upload directories
UPLOAD_DIR = ROOT_DIR / "uploads"
CLIPS_DIR = ROOT_DIR / "clips"
AUDIO_DIR = ROOT_DIR / "audio"
UPLOAD_DIR.mkdir(exist_ok=True)
CLIPS_DIR.mkdir(exist_ok=True)
AUDIO_DIR.mkdir(exist_ok=True)

# Create the main app
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# Models
class TranscriptWord(BaseModel):
    id: int
    start: float
    end: float
    word: str


class TranscriptSegment(BaseModel):
    id: int
    start: float
    end: float
    text: str
    words: Optional[List[TranscriptWord]] = None


class Video(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    filename: str
    original_filename: str
    file_path: str
    file_size: int
    duration: Optional[float] = None
    status: str = "uploading"  # uploading, processing, transcribing, ready, error
    transcript: Optional[List[TranscriptSegment]] = None
    error_message: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ClipRequest(BaseModel):
    segments: List[dict]  # List of {start: float, end: float}


class Clip(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    video_id: str
    filename: str
    file_path: str
    segments: List[dict]
    status: str = "processing"  # processing, ready, error
    error_message: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


def get_video_duration(file_path: str) -> float:
    """Get video duration using ffprobe"""
    try:
        result = subprocess.run(
            ['ffprobe', '-v', 'quiet', '-show_entries', 'format=duration',
             '-of', 'default=noprint_wrappers=1:nokey=1', file_path],
            capture_output=True, text=True
        )
        return float(result.stdout.strip())
    except Exception as e:
        logger.error(f"Error getting duration: {e}")
        return 0.0


def extract_audio(video_path: str, audio_path: str) -> bool:
    """Extract audio from video using ffmpeg"""
    try:
        subprocess.run(
            ['ffmpeg', '-i', video_path, '-vn', '-acodec', 'libmp3lame',
             '-q:a', '2', '-y', audio_path],
            capture_output=True, check=True
        )
        return True
    except Exception as e:
        logger.error(f"Error extracting audio: {e}")
        return False


async def transcribe_audio(audio_path: str) -> List[TranscriptSegment]:
    """Transcribe audio using OpenAI Whisper with word-level timestamps"""
    try:
        stt = OpenAISpeechToText(api_key=os.getenv("EMERGENT_LLM_KEY"))
        
        with open(audio_path, "rb") as audio_file:
            response = await stt.transcribe(
                file=audio_file,
                model="whisper-1",
                response_format="verbose_json",
                timestamp_granularities=["word", "segment"]
            )
        
        logger.info(f"Whisper response type: {type(response)}")
        logger.info(f"Has words attr: {hasattr(response, 'words')}")
        
        segments = []
        
        # Get all words with timestamps if available
        all_words = []
        has_word_timestamps = False
        
        if hasattr(response, 'words') and response.words:
            has_word_timestamps = True
            for idx, w in enumerate(response.words):
                if isinstance(w, dict):
                    all_words.append(TranscriptWord(
                        id=idx,
                        start=w.get('start', 0.0),
                        end=w.get('end', 0.0),
                        word=w.get('word', '').strip()
                    ))
                else:
                    all_words.append(TranscriptWord(
                        id=idx,
                        start=getattr(w, 'start', 0.0),
                        end=getattr(w, 'end', 0.0),
                        word=getattr(w, 'word', '').strip()
                    ))
        
        # Process segments
        if hasattr(response, 'segments') and response.segments:
            global_word_id = 0
            for idx, seg in enumerate(response.segments):
                if isinstance(seg, dict):
                    start = seg.get('start', 0.0)
                    end = seg.get('end', 0.0)
                    text = seg.get('text', '').strip()
                else:
                    start = getattr(seg, 'start', 0.0)
                    end = getattr(seg, 'end', 0.0)
                    text = getattr(seg, 'text', '').strip()
                
                segment_words = []
                
                if has_word_timestamps:
                    # Use actual word timestamps
                    for w in all_words:
                        if w.start >= start - 0.1 and w.end <= end + 0.1:
                            segment_words.append(w)
                else:
                    # Generate estimated word timestamps from segment
                    words_in_text = text.split()
                    if words_in_text:
                        duration = end - start
                        word_duration = duration / len(words_in_text)
                        
                        for i, word_text in enumerate(words_in_text):
                            word_start = start + (i * word_duration)
                            word_end = word_start + word_duration
                            segment_words.append(TranscriptWord(
                                id=global_word_id,
                                start=round(word_start, 3),
                                end=round(word_end, 3),
                                word=word_text
                            ))
                            global_word_id += 1
                
                segments.append(TranscriptSegment(
                    id=idx,
                    start=start,
                    end=end,
                    text=text,
                    words=segment_words if segment_words else None
                ))
        else:
            # Fallback: create single segment
            text = ""
            if hasattr(response, 'text'):
                text = response.text
            elif isinstance(response, dict) and 'text' in response:
                text = response['text']
            
            # Generate words from text
            words_in_text = text.split() if text else []
            estimated_duration = 0.3  # Assume 0.3s per word
            segment_words = []
            for i, word_text in enumerate(words_in_text):
                segment_words.append(TranscriptWord(
                    id=i,
                    start=round(i * estimated_duration, 3),
                    end=round((i + 1) * estimated_duration, 3),
                    word=word_text
                ))
            
            segments.append(TranscriptSegment(
                id=0,
                start=0.0,
                end=len(words_in_text) * estimated_duration,
                text=text,
                words=segment_words if segment_words else None
            ))
        
        return segments
    except Exception as e:
        logger.error(f"Transcription error: {e}")
        raise


async def process_video(video_id: str):
    """Background task to process video"""
    try:
        # Get video from DB
        video_doc = await db.videos.find_one({"id": video_id}, {"_id": 0})
        if not video_doc:
            return
        
        # Update status to processing
        await db.videos.update_one(
            {"id": video_id},
            {"$set": {"status": "processing"}}
        )
        
        # Get duration
        duration = get_video_duration(video_doc['file_path'])
        
        # Extract audio
        audio_path = str(AUDIO_DIR / f"{video_id}.mp3")
        if not extract_audio(video_doc['file_path'], audio_path):
            await db.videos.update_one(
                {"id": video_id},
                {"$set": {"status": "error", "error_message": "Failed to extract audio"}}
            )
            return
        
        # Update status to transcribing
        await db.videos.update_one(
            {"id": video_id},
            {"$set": {"status": "transcribing", "duration": duration}}
        )
        
        # Transcribe
        segments = await transcribe_audio(audio_path)
        
        # Convert segments to dict
        segments_dict = [s.model_dump() for s in segments]
        
        # Update with transcript
        await db.videos.update_one(
            {"id": video_id},
            {"$set": {
                "status": "ready",
                "transcript": segments_dict,
                "duration": duration
            }}
        )
        
        # Clean up audio file
        try:
            os.remove(audio_path)
        except:
            pass
            
    except Exception as e:
        logger.error(f"Error processing video {video_id}: {e}")
        await db.videos.update_one(
            {"id": video_id},
            {"$set": {"status": "error", "error_message": str(e)}}
        )


def create_video_clip(input_path: str, output_path: str, segments: List[dict]) -> bool:
    """Create a video clip from selected segments using ffmpeg"""
    try:
        if not segments:
            return False
        
        # Sort segments by start time
        sorted_segments = sorted(segments, key=lambda x: x['start'])
        
        # Create filter complex for concatenation
        filter_parts = []
        concat_parts = []
        
        for i, seg in enumerate(sorted_segments):
            start = seg['start']
            end = seg['end']
            duration = end - start
            
            filter_parts.append(
                f"[0:v]trim=start={start}:end={end},setpts=PTS-STARTPTS[v{i}];"
                f"[0:a]atrim=start={start}:end={end},asetpts=PTS-STARTPTS[a{i}]"
            )
            concat_parts.append(f"[v{i}][a{i}]")
        
        filter_complex = ";".join(filter_parts) + ";" + "".join(concat_parts) + f"concat=n={len(sorted_segments)}:v=1:a=1[outv][outa]"
        
        cmd = [
            'ffmpeg', '-i', input_path,
            '-filter_complex', filter_complex,
            '-map', '[outv]', '-map', '[outa]',
            '-c:v', 'libx264', '-c:a', 'aac',
            '-y', output_path
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode != 0:
            logger.error(f"FFmpeg error: {result.stderr}")
            return False
            
        return True
    except Exception as e:
        logger.error(f"Error creating clip: {e}")
        return False


# Routes
@api_router.get("/")
async def root():
    return {"message": "Video Transcript Clip Generator API"}


@api_router.post("/videos/upload")
async def upload_video(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    """Upload a video file"""
    # Validate file type
    if not file.filename.lower().endswith(('.mp4', '.mov', '.avi', '.mkv', '.webm')):
        raise HTTPException(status_code=400, detail="Invalid file type. Only video files are allowed.")
    
    # Check file size (500MB limit)
    content = await file.read()
    file_size = len(content)
    
    if file_size > 500 * 1024 * 1024:  # 500MB
        raise HTTPException(status_code=400, detail="File too large. Maximum size is 500MB.")
    
    # Generate unique filename
    video_id = str(uuid.uuid4())
    ext = Path(file.filename).suffix
    filename = f"{video_id}{ext}"
    file_path = str(UPLOAD_DIR / filename)
    
    # Save file
    async with aiofiles.open(file_path, 'wb') as f:
        await f.write(content)
    
    # Create video record
    video = Video(
        id=video_id,
        filename=filename,
        original_filename=file.filename,
        file_path=file_path,
        file_size=file_size,
        status="uploading"
    )
    
    # Convert to dict for MongoDB
    video_dict = video.model_dump()
    video_dict['created_at'] = video_dict['created_at'].isoformat()
    
    await db.videos.insert_one(video_dict)
    
    # Start background processing
    background_tasks.add_task(process_video, video_id)
    
    return {"id": video_id, "status": "uploading", "message": "Video uploaded, processing started"}


@api_router.get("/videos/{video_id}")
async def get_video(video_id: str):
    """Get video details and transcript"""
    video = await db.videos.find_one({"id": video_id}, {"_id": 0})
    
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    
    return video


@api_router.get("/videos/{video_id}/stream")
async def stream_video(video_id: str, range: str = Header(None)):
    """Stream video file with range request support"""
    video = await db.videos.find_one({"id": video_id}, {"_id": 0})
    
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    
    file_path = video['file_path']
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Video file not found")
    
    file_size = os.path.getsize(file_path)
    
    # Determine media type based on file extension
    ext = Path(file_path).suffix.lower()
    media_types = {
        '.mp4': 'video/mp4',
        '.mov': 'video/quicktime',
        '.avi': 'video/x-msvideo',
        '.mkv': 'video/x-matroska',
        '.webm': 'video/webm'
    }
    media_type = media_types.get(ext, 'video/mp4')
    
    # Handle range request for video seeking
    if range:
        range_match = range.replace("bytes=", "").split("-")
        start = int(range_match[0]) if range_match[0] else 0
        end = int(range_match[1]) if range_match[1] else file_size - 1
        
        if start >= file_size:
            raise HTTPException(status_code=416, detail="Range not satisfiable")
        
        end = min(end, file_size - 1)
        content_length = end - start + 1
        
        def iter_file():
            with open(file_path, "rb") as f:
                f.seek(start)
                remaining = content_length
                chunk_size = 1024 * 1024  # 1MB chunks
                while remaining > 0:
                    read_size = min(chunk_size, remaining)
                    data = f.read(read_size)
                    if not data:
                        break
                    remaining -= len(data)
                    yield data
        
        headers = {
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(content_length),
            "Content-Type": media_type,
        }
        
        return StreamingResponse(
            iter_file(),
            status_code=206,
            headers=headers,
            media_type=media_type
        )
    
    # Full file response
    return FileResponse(
        file_path,
        media_type=media_type,
        filename=video['original_filename'],
        headers={"Accept-Ranges": "bytes"}
    )


@api_router.post("/videos/{video_id}/generate-clip")
async def generate_clip(video_id: str, request: ClipRequest, background_tasks: BackgroundTasks):
    """Generate a clip from selected transcript segments"""
    video = await db.videos.find_one({"id": video_id}, {"_id": 0})
    
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    
    if video['status'] != 'ready':
        raise HTTPException(status_code=400, detail="Video is not ready for clipping")
    
    if not request.segments:
        raise HTTPException(status_code=400, detail="No segments selected")
    
    # Validate segments
    for seg in request.segments:
        if 'start' not in seg or 'end' not in seg:
            raise HTTPException(status_code=400, detail="Invalid segment format")
        if seg['start'] >= seg['end']:
            raise HTTPException(status_code=400, detail="Invalid segment: start must be less than end")
    
    # Create clip record
    clip_id = str(uuid.uuid4())
    clip_filename = f"{clip_id}.mp4"
    clip_path = str(CLIPS_DIR / clip_filename)
    
    clip = Clip(
        id=clip_id,
        video_id=video_id,
        filename=clip_filename,
        file_path=clip_path,
        segments=request.segments,
        status="processing"
    )
    
    clip_dict = clip.model_dump()
    clip_dict['created_at'] = clip_dict['created_at'].isoformat()
    
    await db.clips.insert_one(clip_dict)
    
    # Process clip in background
    async def process_clip():
        try:
            success = create_video_clip(video['file_path'], clip_path, request.segments)
            
            if success:
                await db.clips.update_one(
                    {"id": clip_id},
                    {"$set": {"status": "ready"}}
                )
            else:
                await db.clips.update_one(
                    {"id": clip_id},
                    {"$set": {"status": "error", "error_message": "Failed to create clip"}}
                )
        except Exception as e:
            await db.clips.update_one(
                {"id": clip_id},
                {"$set": {"status": "error", "error_message": str(e)}}
            )
    
    background_tasks.add_task(process_clip)
    
    return {"id": clip_id, "status": "processing", "message": "Clip generation started"}


@api_router.get("/clips/{clip_id}")
async def get_clip(clip_id: str):
    """Get clip details"""
    clip = await db.clips.find_one({"id": clip_id}, {"_id": 0})
    
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")
    
    return clip


@api_router.get("/clips/{clip_id}/download")
async def download_clip(clip_id: str):
    """Download clip file"""
    clip = await db.clips.find_one({"id": clip_id}, {"_id": 0})
    
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")
    
    if clip['status'] != 'ready':
        raise HTTPException(status_code=400, detail="Clip is not ready")
    
    if not os.path.exists(clip['file_path']):
        raise HTTPException(status_code=404, detail="Clip file not found")
    
    return FileResponse(
        clip['file_path'],
        media_type="video/mp4",
        filename=f"clip_{clip_id}.mp4",
        headers={"Content-Disposition": f"attachment; filename=clip_{clip_id}.mp4"}
    )


# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
