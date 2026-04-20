from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path('/tmp/dedup-real-handtest-v1')
OUT.mkdir(parents=True, exist_ok=True)


def make_person(path: Path, shirt, accent=(0, 0, 0), skin=(235, 200, 170), pose_shift=0):
    img = Image.new('RGB', (160, 240), (238, 232, 225))
    d = ImageDraw.Draw(img)
    d.ellipse((52 + pose_shift, 20, 108 + pose_shift, 76), fill=skin, outline=(80, 60, 50), width=2)
    d.rounded_rectangle((44 + pose_shift, 76, 116 + pose_shift, 166), radius=16, fill=shirt, outline=(50, 50, 50), width=2)
    d.rectangle((60 + pose_shift, 92, 100 + pose_shift, 128), fill=accent)
    d.rectangle((26 + pose_shift, 84, 44 + pose_shift, 150), fill=skin)
    d.rectangle((116 + pose_shift, 84, 134 + pose_shift, 150), fill=skin)
    d.rectangle((54 + pose_shift, 166, 78 + pose_shift, 228), fill=(45, 45, 70))
    d.rectangle((82 + pose_shift, 166, 106 + pose_shift, 228), fill=(45, 45, 70))
    img.save(path)


make_person(OUT / 'same_a.png', (220, 60, 60), accent=(120, 15, 15))
make_person(OUT / 'same_a_copy.png', (220, 60, 60), accent=(120, 15, 15))
make_person(OUT / 'same_b.png', (210, 72, 72), accent=(110, 18, 18), pose_shift=2)
make_person(OUT / 'same_pose_diff_person.png', (125, 85, 190), accent=(60, 30, 120), skin=(210, 185, 160))
make_person(OUT / 'diff_green.png', (60, 170, 90), accent=(20, 110, 45), skin=(220, 195, 170))
make_person(OUT / 'diff_blue.png', (95, 105, 200), accent=(25, 35, 115), skin=(210, 185, 160))

print(OUT)
