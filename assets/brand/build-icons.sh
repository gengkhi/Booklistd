#!/bin/sh
# Rebuilds every icon/splash PNG in assets/ from the brand sources. Needs ImageMagick 7.
# Run from the repo root: sh assets/brand/build-icons.sh
set -e
cd "$(dirname "$0")/.."
BG='#F3E9D2'   # case-back
INK='#2B1D14'
FONT=../node_modules/@expo-google-fonts/bagel-fat-one/400Regular/BagelFatOne_400Regular.ttf
T=$(mktemp -d)

# Art: the painted shelf with Dewey, trimmed.
magick -background none brand/logo-mark.svg -resize 1024x1024 -trim +repage -resize 680x600 "$T/art.png"

# Wordmark: white Bagel Fat One, 9px ink outline, hard 11px offset shadow.
magick -background none -font "$FONT" -pointsize 200 -fill white label:"Booklistd" -trim +repage -bordercolor none -border 30 "$T/t.png"
magick "$T/t.png" -alpha extract -morphology Dilate Disk:9 -background "$INK" -alpha shape "$T/o.png"
SZ=$(magick identify -format "%[fx:w+12]x%[fx:h+12]" "$T/o.png")
magick -size "$SZ" xc:none "$T/o.png" -geometry +0+0 -composite "$T/o.png" -geometry +11+11 -compose DstOver -composite \
  "$T/t.png" -geometry +0+0 -compose Over -composite -resize 540x brand/wordmark.png

# Lockup (art over name) on a transparent 1024 canvas.
magick -size 1024x1024 xc:none "$T/art.png" -gravity north -geometry +0+120 -composite \
  brand/wordmark.png -gravity south -geometry +0+150 -composite "$T/lockup.png"

magick -size 1024x1024 xc:"$BG" "$T/lockup.png" -composite -alpha off -depth 8 icon.png
magick "$T/lockup.png" -resize 640x640 -background none -gravity center -extent 1024x1024 -depth 8 adaptive-icon.png
magick "$T/lockup.png" -depth 8 splash-icon.png
magick -size 1024x1024 xc:"$BG" "$T/art.png" -gravity center -composite -resize 48x48 -alpha off -depth 8 favicon.png
rm -rf "$T"
echo "icons rebuilt"
