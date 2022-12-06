
# File Watcher

watchman -- watch $HOME/Downloads
watchman \
  -- trigger $HOME/Downloads sort-video '*.mov' '*.mp4' \
  -- deno run --allow-run=ffmpeg --allow-write=$HOME/Downloads \
  $PWD/video.ts --in=$HOME/Downloads --out=$HOME/Movies/Optimized

watchman -- watch $HOME/Desktop
watchman \
  -- trigger $HOME/Desktop sort-video '*.mov' '*.mp4' \
  -- deno run --allow-run=ffmpeg --allow-read=. --allow-write=$HOME/Desktop \
  $PWD/video.ts --in=$HOME/Desktop --out=$HOME/Movies/Optimized


watchman -- trigger-del $HOME/Downloads sort-video
watchman -- watch-del $HOME/Downloads

tail -n 100 /usr/local/var/run/watchman/kishan.patel-state/log

# Exexute and Install

deno run --allow-run=ffmpeg,gs,magick --allow-env=HOME --allow-read --allow-write $PWD/mod.ts

deno install --allow-run=ffmpeg,gs,magick --allow-env=HOME --allow-read --allow-write --name=sorting-machine mod.ts