class RippleGL {
  constructor(canvas, onLost) {
    this.canvas = canvas;
    const gl = this.gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 不可用');
    this.restoreExtension = gl.getExtension('WEBGL_lose_context');
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); onLost(); });
    const compile = (type, text) => {
      const shader = gl.createShader(type); gl.shaderSource(shader, text); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`水波着色器编译失败：${gl.getShaderInfoLog(shader)}`);
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, `#version 300 es\nin vec2 position; out vec2 vUv; void main(){vUv=(position+1.0)*.5;gl_Position=vec4(position,0.,1.);}`);
    const fragment = compile(gl.FRAGMENT_SHADER, window.RIPPLE_FRAGMENT);
    const program = this.program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('水波着色器链接失败');
    gl.useProgram(program);
    const buffer = this.buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    this.uniforms = Object.fromEntries(['uSize','uOrigin','uProgress','uPower','uHasShot','uHasCaustic','uHasNormal','uHasNoise'].map(name => [name, gl.getUniformLocation(program, name)]));
    this.textures = [];
    for (const [i, name] of ['uShot', 'uCaustic', 'uNormal', 'uNoise'].entries()) {
      const texture = gl.createTexture(); this.textures.push(texture); gl.activeTexture(gl.TEXTURE0+i); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, i ? gl.REPEAT : gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, i ? gl.REPEAT : gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128,128,128,255]));
      gl.uniform1i(gl.getUniformLocation(program, name), i);
    }
    this.flags = [0, 0, 0, 0];
  }
  texture(index, image) {
    const gl = this.gl; gl.activeTexture(gl.TEXTURE0+index); gl.bindTexture(gl.TEXTURE_2D, this.textures[index]);
    if (image) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,0]));
    this.flags[index] = image ? 1 : 0;
  }
  draw(payload, progress) {
    const gl = this.gl, u = this.uniforms;
    gl.viewport(0,0,this.canvas.width,this.canvas.height); gl.useProgram(this.program);
    gl.uniform2f(u.uSize, innerWidth, innerHeight); gl.uniform2f(u.uOrigin, payload.origin.x, payload.origin.y);
    gl.uniform1f(u.uProgress, progress); gl.uniform1f(u.uPower, 1+.08*(payload.combo-1));
    ['uHasShot','uHasCaustic','uHasNormal','uHasNoise'].forEach((name, i) => gl.uniform1f(u[name], this.flags[i]));
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  clear() { this.texture(0, null); this.gl.clearColor(0,0,0,0); this.gl.clear(this.gl.COLOR_BUFFER_BIT); }
  restore() { this.restoreExtension?.restoreContext(); }
  dispose() { for (const texture of this.textures) this.gl.deleteTexture(texture); this.gl.deleteBuffer(this.buffer); this.gl.deleteProgram(this.program); }
}
window.RippleGL = RippleGL;
