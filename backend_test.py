#!/usr/bin/env python3

import requests
import sys
import time
import os
import subprocess
from datetime import datetime
from pathlib import Path

class VideoTranscriptAPITester:
    def __init__(self, base_url="https://speech-slicer.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api"
        self.tests_run = 0
        self.tests_passed = 0
        self.test_video_path = None
        self.video_id = None
        self.clip_id = None

    def log(self, message):
        """Log with timestamp"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f"[{timestamp}] {message}")

    def run_test(self, name, method, endpoint, expected_status, data=None, files=None, timeout=30):
        """Run a single API test"""
        url = f"{self.api_url}/{endpoint}" if endpoint else self.api_url
        headers = {}
        
        if data and not files:
            headers['Content-Type'] = 'application/json'

        self.tests_run += 1
        self.log(f"🔍 Testing {name}...")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=timeout)
            elif method == 'POST':
                if files:
                    response = requests.post(url, files=files, data=data, timeout=timeout)
                else:
                    response = requests.post(url, json=data, headers=headers, timeout=timeout)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                self.log(f"✅ {name} - Status: {response.status_code}")
                try:
                    return success, response.json()
                except:
                    return success, response.text
            else:
                self.log(f"❌ {name} - Expected {expected_status}, got {response.status_code}")
                self.log(f"   Response: {response.text[:200]}")
                return False, {}

        except requests.exceptions.Timeout:
            self.log(f"❌ {name} - Request timed out after {timeout}s")
            return False, {}
        except Exception as e:
            self.log(f"❌ {name} - Error: {str(e)}")
            return False, {}

    def create_test_video(self):
        """Create a small test video file using ffmpeg"""
        try:
            self.test_video_path = "/tmp/test_video.mp4"
            
            # Create a 5-second test video with audio
            cmd = [
                'ffmpeg', '-f', 'lavfi', '-i', 'testsrc2=duration=5:size=320x240:rate=1',
                '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=5',
                '-c:v', 'libx264', '-c:a', 'aac', '-shortest', '-y', self.test_video_path
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            
            if result.returncode == 0 and os.path.exists(self.test_video_path):
                file_size = os.path.getsize(self.test_video_path)
                self.log(f"✅ Created test video: {file_size} bytes")
                return True
            else:
                self.log(f"❌ Failed to create test video: {result.stderr}")
                return False
                
        except Exception as e:
            self.log(f"❌ Error creating test video: {str(e)}")
            return False

    def test_root_endpoint(self):
        """Test the root API endpoint"""
        success, response = self.run_test(
            "Root API Endpoint",
            "GET",
            "",
            200
        )
        return success

    def test_video_upload(self):
        """Test video upload functionality"""
        if not self.test_video_path or not os.path.exists(self.test_video_path):
            self.log("❌ No test video available for upload")
            return False

        try:
            with open(self.test_video_path, 'rb') as f:
                files = {'file': ('test_video.mp4', f, 'video/mp4')}
                success, response = self.run_test(
                    "Video Upload",
                    "POST",
                    "videos/upload",
                    200,
                    files=files,
                    timeout=60
                )
                
                if success and isinstance(response, dict) and 'id' in response:
                    self.video_id = response['id']
                    self.log(f"   Video ID: {self.video_id}")
                    return True
                    
        except Exception as e:
            self.log(f"❌ Upload error: {str(e)}")
            
        return False

    def test_invalid_file_upload(self):
        """Test upload with invalid file type"""
        try:
            # Create a text file
            test_file_path = "/tmp/test.txt"
            with open(test_file_path, 'w') as f:
                f.write("This is not a video file")
            
            with open(test_file_path, 'rb') as f:
                files = {'file': ('test.txt', f, 'text/plain')}
                success, response = self.run_test(
                    "Invalid File Upload (should fail)",
                    "POST",
                    "videos/upload",
                    400,  # Expecting 400 error
                    files=files
                )
                
            os.remove(test_file_path)
            return success
            
        except Exception as e:
            self.log(f"❌ Invalid file test error: {str(e)}")
            return False

    def test_video_retrieval(self):
        """Test video retrieval"""
        if not self.video_id:
            self.log("❌ No video ID available for retrieval test")
            return False

        success, response = self.run_test(
            "Video Retrieval",
            "GET",
            f"videos/{self.video_id}",
            200
        )
        
        if success and isinstance(response, dict):
            status = response.get('status', 'unknown')
            self.log(f"   Video status: {status}")
            return True
            
        return False

    def test_video_streaming(self):
        """Test video streaming endpoint"""
        if not self.video_id:
            self.log("❌ No video ID available for streaming test")
            return False

        # For streaming, we use GET request with range header to test partial content
        url = f"{self.api_url}/videos/{self.video_id}/stream"
        
        try:
            # Test with a simple GET request first
            response = requests.get(url, timeout=10, stream=True)
            success = response.status_code in [200, 206]  # 206 for partial content
            
            if success:
                self.tests_passed += 1
                self.log(f"✅ Video Streaming - Status: {response.status_code}")
                # Close the stream
                response.close()
            else:
                self.log(f"❌ Video Streaming - Status: {response.status_code}")
                
            self.tests_run += 1
            return success
            
        except Exception as e:
            self.log(f"❌ Video Streaming - Error: {str(e)}")
            self.tests_run += 1
            return False

    def wait_for_transcription(self, max_wait=120):
        """Wait for video transcription to complete"""
        if not self.video_id:
            return False
            
        self.log("⏳ Waiting for transcription to complete...")
        start_time = time.time()
        
        while time.time() - start_time < max_wait:
            try:
                response = requests.get(f"{self.api_url}/videos/{self.video_id}", timeout=10)
                if response.status_code == 200:
                    data = response.json()
                    status = data.get('status', 'unknown')
                    
                    if status == 'ready':
                        self.log("✅ Transcription completed")
                        return True
                    elif status == 'error':
                        self.log(f"❌ Transcription failed: {data.get('error_message', 'Unknown error')}")
                        return False
                    else:
                        self.log(f"   Status: {status}")
                        
                time.sleep(5)
                
            except Exception as e:
                self.log(f"   Error checking status: {str(e)}")
                time.sleep(5)
        
        self.log(f"❌ Transcription timeout after {max_wait}s")
        return False

    def test_clip_generation(self):
        """Test clip generation"""
        if not self.video_id:
            self.log("❌ No video ID available for clip generation")
            return False

        # Create test segments
        segments = [
            {"start": 0.0, "end": 2.0},
            {"start": 3.0, "end": 5.0}
        ]
        
        success, response = self.run_test(
            "Clip Generation",
            "POST",
            f"videos/{self.video_id}/generate-clip",
            200,
            data={"segments": segments},
            timeout=60
        )
        
        if success and isinstance(response, dict) and 'id' in response:
            self.clip_id = response['id']
            self.log(f"   Clip ID: {self.clip_id}")
            return True
            
        return False

    def wait_for_clip_generation(self, max_wait=60):
        """Wait for clip generation to complete"""
        if not self.clip_id:
            return False
            
        self.log("⏳ Waiting for clip generation to complete...")
        start_time = time.time()
        
        while time.time() - start_time < max_wait:
            try:
                response = requests.get(f"{self.api_url}/clips/{self.clip_id}", timeout=10)
                if response.status_code == 200:
                    data = response.json()
                    status = data.get('status', 'unknown')
                    
                    if status == 'ready':
                        self.log("✅ Clip generation completed")
                        return True
                    elif status == 'error':
                        self.log(f"❌ Clip generation failed: {data.get('error_message', 'Unknown error')}")
                        return False
                    else:
                        self.log(f"   Status: {status}")
                        
                time.sleep(3)
                
            except Exception as e:
                self.log(f"   Error checking clip status: {str(e)}")
                time.sleep(3)
        
        self.log(f"❌ Clip generation timeout after {max_wait}s")
        return False

    def test_clip_download(self):
        """Test clip download"""
        if not self.clip_id:
            self.log("❌ No clip ID available for download test")
            return False

        url = f"{self.api_url}/clips/{self.clip_id}/download"
        
        try:
            response = requests.head(url, timeout=10)
            success = response.status_code == 200
            
            if success:
                self.tests_passed += 1
                self.log(f"✅ Clip Download - Status: {response.status_code}")
            else:
                self.log(f"❌ Clip Download - Status: {response.status_code}")
                
            self.tests_run += 1
            return success
            
        except Exception as e:
            self.log(f"❌ Clip Download - Error: {str(e)}")
            self.tests_run += 1
            return False

    def cleanup(self):
        """Clean up test files"""
        if self.test_video_path and os.path.exists(self.test_video_path):
            try:
                os.remove(self.test_video_path)
                self.log("🧹 Cleaned up test video file")
            except:
                pass

    def run_all_tests(self):
        """Run all tests in sequence"""
        self.log("🚀 Starting Video Transcript API Tests")
        self.log(f"   Base URL: {self.base_url}")
        
        # Create test video
        if not self.create_test_video():
            self.log("❌ Cannot proceed without test video")
            return 1

        # Test basic API
        if not self.test_root_endpoint():
            self.log("❌ Root endpoint failed - API may be down")
            return 1

        # Test file validation
        self.test_invalid_file_upload()

        # Test video upload
        if not self.test_video_upload():
            self.log("❌ Video upload failed - cannot proceed with other tests")
            return 1

        # Test video retrieval
        self.test_video_retrieval()
        
        # Test video streaming
        self.test_video_streaming()

        # Wait for transcription (this tests the background processing)
        transcription_ready = self.wait_for_transcription()
        
        if transcription_ready:
            # Test clip generation
            if self.test_clip_generation():
                # Wait for clip to be ready
                if self.wait_for_clip_generation():
                    # Test clip download
                    self.test_clip_download()

        # Print results
        self.log(f"\n📊 Test Results: {self.tests_passed}/{self.tests_run} passed")
        
        if self.tests_passed == self.tests_run:
            self.log("🎉 All tests passed!")
            return 0
        else:
            self.log(f"❌ {self.tests_run - self.tests_passed} tests failed")
            return 1

def main():
    tester = VideoTranscriptAPITester()
    
    try:
        result = tester.run_all_tests()
        return result
    finally:
        tester.cleanup()

if __name__ == "__main__":
    sys.exit(main())