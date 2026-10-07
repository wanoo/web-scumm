### Changes

- **The release workflow's install steps get 20 minutes instead of 8 (4.1.15)**: the `v4.1.10-rc.1` release job timed
  out on `apt-get install ffmpeg` on 7 October 2026, as CI's jobs had a dozen times that day (ci.yml got the same in 4.1.14).
- **ffmpeg on the runners through `scripts/ci-ffmpeg.sh` (4.1.15)**: apt first, bounded to four minutes an attempt,
  then a static build from GitHub's CDN (BtbN/FFmpeg-Builds) when the apt mirror hangs, as it did for twenty minutes
  without a byte on 7 October 2026. Every ci.yml and release.yml job that needs ffmpeg uses it.
