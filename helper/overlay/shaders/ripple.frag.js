window.RIPPLE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform vec2 uSize;
uniform vec2 uOrigin;
uniform float uProgress;
uniform float uPower;
uniform float uHasShot;
uniform float uHasCaustic;
uniform float uHasNormal;
uniform float uHasNoise;
uniform sampler2D uShot;
uniform sampler2D uCaustic;
uniform sampler2D uNormal;
uniform sampler2D uNoise;
void main() {
  vec2 uv = vec2(vUv.x, 1.0-vUv.y);
  vec2 delta = uv*uSize-uOrigin;
  float distancePx = length(delta);
  vec2 direction = delta / max(distancePx, 1.0);
  float diagonal = length(uSize);
  float displacement = 0.0;
  float crest = 0.0;
  for (int i=0; i<4; i++) {
    float age = max(0.0, uProgress-float(i)*0.045);
    float radius = pow(clamp(age*2.5, 0.0, 1.0), 0.74)*diagonal*1.12;
    float width = mix(80.0, 16.0, clamp(age*2.0, 0.0, 1.0));
    float d = distancePx-radius;
    float band = exp(-d*d/(width*width));
    float attenuation = pow(0.55, float(i))*(1.0-smoothstep(0.25,0.83,uProgress));
    displacement += sin(d*0.049)*band*22.0*attenuation*uPower;
    crest += band*attenuation;
  }
  vec2 detail = (texture(uNormal, uv*3.0+vec2(uProgress*.03)).rg-.5)*uHasNormal*crest*.0012;
  vec2 shift = direction*displacement/uSize+detail;
  float fringe = crest*1.6/uSize.x;
  vec3 shot;
  shot.r = texture(uShot, clamp(uv+shift+direction*fringe, .001, .999)).r;
  shot.g = texture(uShot, clamp(uv+shift, .001, .999)).g;
  shot.b = texture(uShot, clamp(uv+shift-direction*fringe, .001, .999)).b;
  float fade = 1.0-smoothstep(.76,1.0,uProgress);
  vec2 cUV = uv*3.5+vec2(uProgress*.026, -uProgress*.019);
  float c = texture(uCaustic,cUV).r*uHasCaustic;
  float procedural = pow(max(0.0, sin(uv.x*41.0+sin(uv.y*25.0))+cos(uv.y*47.0+sin(uv.x*22.0)))*.5, 6.0);
  c = max(c, procedural*.4)*sin(clamp(uProgress,0.0,1.0)*3.14159)*.10;
  float grain = (texture(uNoise,uv*uSize/512.0).r-.5)*uHasNoise*.014;
  vec3 light = vec3(.48,.77,.88)*(c+crest*.025+grain);
  float a = uHasShot*fade;
  if (uHasShot < .5) {
    a = clamp(c+crest*.026,0.0,.16)*fade;
    fragColor = vec4(vec3(.55,.85,.96)*a, a);
  } else {
    fragColor = vec4((shot+light)*fade, a);
  }
}`;
