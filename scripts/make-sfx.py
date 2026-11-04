"""离线合成原创鲸歌与水声，不使用任何采样素材。"""
from pathlib import Path
import wave
import numpy as np

ROOT = Path(__file__).resolve().parents[1] / "assets/sfx"
ROOT.mkdir(parents=True, exist_ok=True)
SR = 44100
rng = np.random.default_rng(42)

def tone(freq, seconds, decay=4):
    t = np.arange(int(SR * seconds)) / SR
    f = freq(t) if callable(freq) else np.full_like(t, freq)
    phase = np.cumsum(f) * 2 * np.pi / SR
    envelope = (1-np.exp(-t*700)) * np.exp(-t*decay)
    envelope *= np.minimum(1, (seconds-t)*60)
    return t, phase, envelope

def save(name, signal, peak=.83):
    signal = np.nan_to_num(signal)
    signal = signal / max(float(np.max(np.abs(signal))), .001) * peak
    with wave.open(str(ROOT / f"{name}.wav"), "wb") as file:
        file.setparams((1, 2, SR, len(signal), "NONE", "未压缩"))
        file.writeframes((signal*32767).astype("<i2").tobytes())

def moan(base, seconds):
    t, phase, env = tone(lambda t: base*(1+.08*np.sin(t*2.1)+.025*np.sin(t*32.67)), seconds, .6)
    signal = sum(np.sin(phase*k)/(k**1.4) for k in range(1, 7)) * env
    signal += rng.normal(0, .025, len(t)) * env
    for delay, gain in [(.19, .3), (.39, .19), (.71, .12)]:
        n = int(delay*SR)
        signal[n:] += signal[:-n].copy()*gain
    return signal

t, p, e = tone(lambda t: (85+335*np.exp(-t/.06))*(1+.08*np.sin(t*44)), .25, 13)
save("click_boing", (np.sin(p)+.2*np.sin(2*p))*e)
for i in range(1, 8):
    t, p, e = tone(lambda t, i=i: 440*2**(i/12)*(1+.03*np.sin(t*113)), .18, 14)
    save(f"combo_{i}", np.sin(p)*e)
for i, base in enumerate([55, 62, 70, 82, 98], 1):
    save(f"moan_idle_{i}", moan(base, 1.6+i*.32))
save("deep_song", moan(52, 7)+.4*moan(69, 7))
t, p, e = tone(lambda t: 1200*(1+.16*np.sin(t*69)), .4, 6)
save("drag_squeak", (np.sin(p)+rng.normal(0, .15, len(t)))*e)
t, p, e = tone(1800, .08, 60)
save("bubble_blip", np.sin(p)*e)
for name, duration in [("splash_big", .9), ("drop_plop", .6)]:
    t, p, e = tone(lambda t: 60+100*np.exp(-t*12), duration, 7)
    noise = rng.normal(0, 1, len(t))
    smooth = np.convolve(noise, np.ones(12)/12, "same")
    signal = (smooth*1.8+np.sin(p)*.5)*e
    for _ in range(40 if name == "splash_big" else 8):
        start = int(rng.uniform(.02, duration-.09)*SR)
        bt, bp, be = tone(rng.uniform(900, 5500), .08, 65)
        signal[start:start+len(bt)] += .15*np.sin(bp)*be
    save(name, signal)
t, p, e = tone(440, 1.2, 2)
signal = sum(2*((t*f)%1)-1 for f in [440, 554, 659])
save("rare_airhorn", np.tanh(signal*3)*e, .65)
t = np.arange(SR*30)/SR
# 整数周期保证环境音循环点连续。
save("ambient_underwater", sum(np.sin(2*np.pi*f*t)/f for f in [31, 43, 59, 73, 97]), .32)
print(f"已生成 {len(list(ROOT.glob('*.wav')))} 个原创音效")
