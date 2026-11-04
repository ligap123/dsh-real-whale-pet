"""整理已抠好的透明素材；保留白色腹部，不使用颜色阈值去背。"""
import argparse
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description="检查透明鲸鱼并生成插件图标")
parser.add_argument("source", type=Path)
args = parser.parse_args()
with Image.open(args.source) as original:
    image = original.convert("RGBA")
if image.getchannel("A").getextrema()[0] != 0:
    raise SystemExit("输入图片没有透明背景，请先去背或使用绿幕分割")
# 修正生成工具在实体内部留下的近不透明值，不触碰边缘软透明。
image.putalpha(image.getchannel("A").point(lambda alpha: 255 if alpha >= 245 else alpha))
target = ROOT / "assets/whale/whale-hero.png"
target.parent.mkdir(parents=True, exist_ok=True)
image.save(target, optimize=True)
icon = Image.new("RGBA", (256, 256))
small = image.copy()
small.thumbnail((220, 220), Image.Resampling.LANCZOS)
icon.alpha_composite(small, ((256-small.width)//2, (256-small.height)//2))
icon.save(ROOT / "assets/icon.png", optimize=True)
print(f"鲸鱼 {image.size}，透明通道有效，图标已保存")
