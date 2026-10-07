### Changes

- **The release workflow's install steps get 20 minutes instead of 8 (4.1.15)**: the `v4.1.10-rc.1` release job timed
  out on `apt-get install ffmpeg` on 7 October 2026, as CI's jobs had a dozen times that day (ci.yml got the same in 4.1.14).
