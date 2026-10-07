## `chore/release-install-timeouts`: release.yml's install steps at 20 minutes

- The 4.1.10 candidate's release job (run 37676117503) died on the ffmpeg install after 8 minutes while GitHub's runners
  were slow to download; the release job is the last step of a chain of about an hour, so a timeout there costs the
  most. Same change as ci.yml's in 4.1.14. No reading asked: a timeout value.
→ next: Claude · the remaining tags of the programme
