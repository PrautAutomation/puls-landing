(function () {
  const smokeField = document.getElementById("utulekSmokeField");
  const fallbackHalo = document.getElementById("utulekFallbackHalo");
  const quoteCard = document.getElementById("utulekQuoteCard");
  const canvas = document.getElementById("utulekSmokeCanvas");
  const section = document.getElementById("tereza-quote");

  if (!smokeField || !fallbackHalo || !quoteCard || !canvas || !section) return;

  const config = {
    SIM_RESOLUTION: 128,
    DYE_RESOLUTION: 1024,
    DENSITY_DISSIPATION: 2.0,
    VELOCITY_DISSIPATION: 1.5,
    PRESSURE: 0.1,
    PRESSURE_ITERATIONS: 20,
    CURL: 2,
    SPLAT_RADIUS: 0.3,
    SPLAT_FORCE: 4000,
    SHADING: true,
    AUTO_SPLAT_INTERVAL: 1200,
    AUTO_SPLAT_COUNT: 2,
    INITIAL_SPLAT_COUNT: 42,
    IGNITION_DURATION: 2400,
    COLOR_GAIN: 5.2,
    IGNITION_COLOR_GAIN: 0.46
  };

  const ignitionColors = [
    { weight: 0.62, color: { r: 0.30, g: 0.17, b: 0.05 } },
    { weight: 0.22, color: { r: 0.12, g: 0.035, b: 0.20 } },
    { weight: 0.10, color: { r: 0.035, g: 0.16, b: 0.18 } },
    { weight: 0.06, color: { r: 0.15, g: 0.025, b: 0.13 } }
  ];

  const settledColors = [
    { weight: 1, color: { r: 0.36, g: 0.21, b: 0.055 } }
  ];

  class UtulekFluidField {
    constructor(canvasElement, quoteElement) {
      this.canvas = canvasElement;
      this.quoteElement = quoteElement;
      this.config = { ...config };
      this.gl = null;
      this.ext = null;
      this.dye = null;
      this.velocity = null;
      this.divergence = null;
      this.curl = null;
      this.pressure = null;
      this.lastUpdateTime = Date.now();
      this.animationId = null;
      this.autoTimer = null;
      this.running = false;
      this.boundary = { minY: 0, maxY: 1 };
      this.startedAt = 0;
      this.init();
    }

    init() {
      this.initializeWebGL();
      if (!this.gl) return;
      this.initializeShaders();
      this.initializeBlit();
      this.resizeCanvas();
      this.initFramebuffers();
    }

    initializeWebGL() {
      const params = {
        alpha: true,
        depth: false,
        stencil: false,
        antialias: false,
        preserveDrawingBuffer: false
      };
      const gl = this.canvas.getContext("webgl2", params) ||
        this.canvas.getContext("webgl", params) ||
        this.canvas.getContext("experimental-webgl", params);

      if (!gl) return;

      const isWebGL2 = "drawBuffers" in gl;
      let supportLinearFiltering = false;
      let halfFloat = null;

      if (isWebGL2) {
        gl.getExtension("EXT_color_buffer_float");
        supportLinearFiltering = !!gl.getExtension("OES_texture_float_linear");
      } else {
        halfFloat = gl.getExtension("OES_texture_half_float");
        supportLinearFiltering = !!gl.getExtension("OES_texture_half_float_linear");
      }

      gl.clearColor(0, 0, 0, 0);

      const halfFloatTexType = isWebGL2 ? gl.HALF_FLOAT : (halfFloat && halfFloat.HALF_FLOAT_OES) || 0;
      const formatRGBA = isWebGL2
        ? this.getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, halfFloatTexType)
        : this.getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
      const formatRG = isWebGL2
        ? this.getSupportedFormat(gl, gl.RG16F, gl.RG, halfFloatTexType)
        : this.getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
      const formatR = isWebGL2
        ? this.getSupportedFormat(gl, gl.R16F, gl.RED, halfFloatTexType)
        : this.getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);

      if (!formatRGBA || !formatRG || !formatR) return;

      this.gl = gl;
      this.ext = { formatRGBA, formatRG, formatR, halfFloatTexType, supportLinearFiltering };

      if (!supportLinearFiltering) {
        this.config.DYE_RESOLUTION = 256;
        this.config.SHADING = false;
      }
    }

    getSupportedFormat(gl, internalFormat, format, type) {
      if (!this.supportRenderTextureFormat(gl, internalFormat, format, type)) {
        if ("drawBuffers" in gl) {
          if (internalFormat === gl.R16F) return this.getSupportedFormat(gl, gl.RG16F, gl.RG, type);
          if (internalFormat === gl.RG16F) return this.getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, type);
        }
        return null;
      }
      return { internalFormat, format };
    }

    supportRenderTextureFormat(gl, internalFormat, format, type) {
      const texture = gl.createTexture();
      const fbo = gl.createFramebuffer();
      if (!texture || !fbo) return false;

      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    }

    compileShader(type, source, keywords = null) {
      const gl = this.gl;
      const shader = gl.createShader(type);
      const prefix = keywords ? keywords.map((keyword) => `#define ${keyword}\n`).join("") : "";
      gl.shaderSource(shader, prefix + source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
      }
      return shader;
    }

    createProgram(vertexShader, fragmentShader) {
      const gl = this.gl;
      const program = gl.createProgram();
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.bindAttribLocation(program, 0, "aPosition");
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error(gl.getProgramInfoLog(program));
      }
      return program;
    }

    getUniforms(program) {
      const gl = this.gl;
      const uniforms = {};
      const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < uniformCount; i++) {
        const uniformInfo = gl.getActiveUniform(program, i);
        uniforms[uniformInfo.name] = gl.getUniformLocation(program, uniformInfo.name);
      }
      return uniforms;
    }

    makeProgram(vertexShader, fragmentShader) {
      const program = this.createProgram(vertexShader, fragmentShader);
      return {
        program,
        uniforms: this.getUniforms(program),
        bind: () => this.gl.useProgram(program)
      };
    }

    initializeShaders() {
      const gl = this.gl;
      const baseVertexShader = this.compileShader(gl.VERTEX_SHADER, `
        precision highp float;
        attribute vec2 aPosition;
        varying vec2 vUv;
        varying vec2 vL;
        varying vec2 vR;
        varying vec2 vT;
        varying vec2 vB;
        uniform vec2 texelSize;
        void main () {
          vUv = aPosition * 0.5 + 0.5;
          vL = vUv - vec2(texelSize.x, 0.0);
          vR = vUv + vec2(texelSize.x, 0.0);
          vT = vUv + vec2(0.0, texelSize.y);
          vB = vUv - vec2(0.0, texelSize.y);
          gl_Position = vec4(aPosition, 0.0, 1.0);
        }
      `);

      const copyShader = this.compileShader(gl.FRAGMENT_SHADER, `
        precision mediump float;
        precision mediump sampler2D;
        varying highp vec2 vUv;
        uniform sampler2D uTexture;
        void main () {
          gl_FragColor = texture2D(uTexture, vUv);
        }
      `);

      const clearShader = this.compileShader(gl.FRAGMENT_SHADER, `
        precision mediump float;
        precision mediump sampler2D;
        varying highp vec2 vUv;
        uniform sampler2D uTexture;
        uniform float value;
        void main () {
          gl_FragColor = value * texture2D(uTexture, vUv);
        }
      `);

      const displayShaderSource = `
        precision highp float;
        precision highp sampler2D;
        varying vec2 vUv;
        varying vec2 vL;
        varying vec2 vR;
        varying vec2 vT;
        varying vec2 vB;
        uniform sampler2D uTexture;
        uniform vec2 texelSize;
        void main () {
          vec3 c = texture2D(uTexture, vUv).rgb;
          #ifdef SHADING
            vec3 lc = texture2D(uTexture, vL).rgb;
            vec3 rc = texture2D(uTexture, vR).rgb;
            vec3 tc = texture2D(uTexture, vT).rgb;
            vec3 bc = texture2D(uTexture, vB).rgb;
            float dx = length(rc) - length(lc);
            float dy = length(tc) - length(bc);
            vec3 n = normalize(vec3(dx, dy, length(texelSize)));
            vec3 l = vec3(0.0, 0.0, 1.0);
            float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
            c *= diffuse;
          #endif
          c *= 2.2;
          float a = max(c.r, max(c.g, c.b));
          gl_FragColor = vec4(c, clamp(a, 0.0, 0.62));
        }
      `;

      const splatShader = this.compileShader(gl.FRAGMENT_SHADER, `
        precision highp float;
        precision highp sampler2D;
        varying vec2 vUv;
        uniform sampler2D uTarget;
        uniform float aspectRatio;
        uniform vec3 color;
        uniform vec2 point;
        uniform float radius;
        void main () {
          vec2 p = vUv - point.xy;
          p.x *= aspectRatio;
          vec3 splat = exp(-dot(p, p) / radius) * color;
          vec3 base = texture2D(uTarget, vUv).xyz;
          gl_FragColor = vec4(base + splat, 1.0);
        }
      `);

      const advectionShader = this.compileShader(gl.FRAGMENT_SHADER, `
        precision highp float;
        precision highp sampler2D;
        varying vec2 vUv;
        uniform sampler2D uVelocity;
        uniform sampler2D uSource;
        uniform vec2 texelSize;
        uniform vec2 dyeTexelSize;
        uniform float dt;
        uniform float dissipation;
        uniform float boundaryMinY;
        uniform float boundaryMaxY;
        uniform float isVelocity;
        vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
          vec2 st = uv / tsize - 0.5;
          vec2 iuv = floor(st);
          vec2 fuv = fract(st);
          vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
          vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
          vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
          vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
          return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
        }
        void main () {
          vec2 vel = texture2D(uVelocity, vUv).xy;
          vec2 coord = vUv - dt * vel * texelSize;
          float reflected = 0.0;
          if (coord.y < boundaryMinY) {
            coord.y = boundaryMinY + (boundaryMinY - coord.y);
            reflected = 1.0;
          }
          if (coord.y > boundaryMaxY) {
            coord.y = boundaryMaxY - (coord.y - boundaryMaxY);
            reflected = 1.0;
          }
          coord = clamp(coord, 0.001, 0.999);
          #ifdef MANUAL_FILTERING
            vec4 result = bilerp(uSource, coord, dyeTexelSize);
          #else
            vec4 result = texture2D(uSource, coord);
          #endif
          if (isVelocity > 0.5 && reflected > 0.5) result.y *= -0.82;
          float decay = 1.0 + dissipation * dt;
          gl_FragColor = result / decay;
        }
      `, this.ext.supportLinearFiltering ? null : ["MANUAL_FILTERING"]);

      const divergenceShader = this.compileShader(gl.FRAGMENT_SHADER, `
        precision mediump float;
        precision mediump sampler2D;
        varying highp vec2 vUv;
        varying highp vec2 vL;
        varying highp vec2 vR;
        varying highp vec2 vT;
        varying highp vec2 vB;
        uniform sampler2D uVelocity;
        void main () {
          float L = texture2D(uVelocity, vL).x;
          float R = texture2D(uVelocity, vR).x;
          float T = texture2D(uVelocity, vT).y;
          float B = texture2D(uVelocity, vB).y;
          vec2 C = texture2D(uVelocity, vUv).xy;
          if (vL.x < 0.0) L = -C.x;
          if (vR.x > 1.0) R = -C.x;
          if (vT.y > 1.0) T = -C.y;
          if (vB.y < 0.0) B = -C.y;
          float div = 0.5 * (R - L + T - B);
          gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
        }
      `);

      const curlShader = this.compileShader(gl.FRAGMENT_SHADER, `
        precision mediump float;
        precision mediump sampler2D;
        varying highp vec2 vUv;
        varying highp vec2 vL;
        varying highp vec2 vR;
        varying highp vec2 vT;
        varying highp vec2 vB;
        uniform sampler2D uVelocity;
        void main () {
          float L = texture2D(uVelocity, vL).y;
          float R = texture2D(uVelocity, vR).y;
          float T = texture2D(uVelocity, vT).x;
          float B = texture2D(uVelocity, vB).x;
          float vorticity = R - L - T + B;
          gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
        }
      `);

      const vorticityShader = this.compileShader(gl.FRAGMENT_SHADER, `
        precision highp float;
        precision highp sampler2D;
        varying vec2 vUv;
        varying vec2 vL;
        varying vec2 vR;
        varying vec2 vT;
        varying vec2 vB;
        uniform sampler2D uVelocity;
        uniform sampler2D uCurl;
        uniform float curl;
        uniform float dt;
        void main () {
          float L = texture2D(uCurl, vL).x;
          float R = texture2D(uCurl, vR).x;
          float T = texture2D(uCurl, vT).x;
          float B = texture2D(uCurl, vB).x;
          float C = texture2D(uCurl, vUv).x;
          vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
          force /= length(force) + 0.0001;
          force *= curl * C;
          force.y *= -1.0;
          vec2 velocity = texture2D(uVelocity, vUv).xy;
          velocity += force * dt;
          velocity = min(max(velocity, -1000.0), 1000.0);
          gl_FragColor = vec4(velocity, 0.0, 1.0);
        }
      `);

      const pressureShader = this.compileShader(gl.FRAGMENT_SHADER, `
        precision mediump float;
        precision mediump sampler2D;
        varying highp vec2 vUv;
        varying highp vec2 vL;
        varying highp vec2 vR;
        varying highp vec2 vT;
        varying highp vec2 vB;
        uniform sampler2D uPressure;
        uniform sampler2D uDivergence;
        void main () {
          float L = texture2D(uPressure, vL).x;
          float R = texture2D(uPressure, vR).x;
          float T = texture2D(uPressure, vT).x;
          float B = texture2D(uPressure, vB).x;
          float divergence = texture2D(uDivergence, vUv).x;
          float pressure = (L + R + B + T - divergence) * 0.25;
          gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
        }
      `);

      const gradientSubtractShader = this.compileShader(gl.FRAGMENT_SHADER, `
        precision mediump float;
        precision mediump sampler2D;
        varying highp vec2 vUv;
        varying highp vec2 vL;
        varying highp vec2 vR;
        varying highp vec2 vT;
        varying highp vec2 vB;
        uniform sampler2D uPressure;
        uniform sampler2D uVelocity;
        void main () {
          float L = texture2D(uPressure, vL).x;
          float R = texture2D(uPressure, vR).x;
          float T = texture2D(uPressure, vT).x;
          float B = texture2D(uPressure, vB).x;
          vec2 velocity = texture2D(uVelocity, vUv).xy;
          velocity.xy -= vec2(R - L, T - B);
          gl_FragColor = vec4(velocity, 0.0, 1.0);
        }
      `);

      this.copyProgram = this.makeProgram(baseVertexShader, copyShader);
      this.clearProgram = this.makeProgram(baseVertexShader, clearShader);
      this.splatProgram = this.makeProgram(baseVertexShader, splatShader);
      this.advectionProgram = this.makeProgram(baseVertexShader, advectionShader);
      this.divergenceProgram = this.makeProgram(baseVertexShader, divergenceShader);
      this.curlProgram = this.makeProgram(baseVertexShader, curlShader);
      this.vorticityProgram = this.makeProgram(baseVertexShader, vorticityShader);
      this.pressureProgram = this.makeProgram(baseVertexShader, pressureShader);
      this.gradientSubtractProgram = this.makeProgram(baseVertexShader, gradientSubtractShader);
      const displayShader = this.compileShader(gl.FRAGMENT_SHADER, displayShaderSource, this.config.SHADING ? ["SHADING"] : null);
      this.displayMaterial = this.makeProgram(baseVertexShader, displayShader);
    }

    initializeBlit() {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(0);
      this.blit = (target, doClear = false) => {
        if (!target) {
          gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        } else {
          gl.viewport(0, 0, target.width, target.height);
          gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
        }
        if (doClear) {
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
        }
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
      };
    }

    createFBO(w, h, internalFormat, format, type, param) {
      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE0);
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      gl.viewport(0, 0, w, h);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return {
        texture,
        fbo,
        width: w,
        height: h,
        texelSizeX: 1 / w,
        texelSizeY: 1 / h,
        attach: (id) => {
          gl.activeTexture(gl.TEXTURE0 + id);
          gl.bindTexture(gl.TEXTURE_2D, texture);
          return id;
        }
      };
    }

    createDoubleFBO(w, h, internalFormat, format, type, param) {
      const fbo1 = this.createFBO(w, h, internalFormat, format, type, param);
      const fbo2 = this.createFBO(w, h, internalFormat, format, type, param);
      return {
        width: w,
        height: h,
        texelSizeX: fbo1.texelSizeX,
        texelSizeY: fbo1.texelSizeY,
        read: fbo1,
        write: fbo2,
        swap() {
          const tmp = this.read;
          this.read = this.write;
          this.write = tmp;
        }
      };
    }

    getResolution(resolution) {
      const w = this.gl.drawingBufferWidth;
      const h = this.gl.drawingBufferHeight;
      const aspectRatio = w / h;
      const aspect = aspectRatio < 1 ? 1 / aspectRatio : aspectRatio;
      const min = Math.round(resolution);
      const max = Math.round(resolution * aspect);
      return w > h ? { width: max, height: min } : { width: min, height: max };
    }

    scaleByPixelRatio(input) {
      return Math.floor(input * (window.devicePixelRatio || 1));
    }

    resizeCanvas() {
      const width = this.scaleByPixelRatio(this.canvas.clientWidth);
      const height = this.scaleByPixelRatio(this.canvas.clientHeight);
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.updateBoundary();
        return true;
      }
      return false;
    }

    updateBoundary() {
      const field = this.canvas.getBoundingClientRect();
      const quote = this.quoteElement.getBoundingClientRect();
      const top = Math.max(0, quote.top - field.top);
      const bottom = Math.min(field.height, quote.bottom - field.top);
      this.boundary.maxY = 1 - top / field.height;
      this.boundary.minY = 1 - bottom / field.height;
    }

    initFramebuffers() {
      const gl = this.gl;
      const simRes = this.getResolution(this.config.SIM_RESOLUTION);
      const dyeRes = this.getResolution(this.config.DYE_RESOLUTION);
      const texType = this.ext.halfFloatTexType;
      const rgba = this.ext.formatRGBA;
      const rg = this.ext.formatRG;
      const r = this.ext.formatR;
      const filtering = this.ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;
      gl.disable(gl.BLEND);
      this.dye = this.createDoubleFBO(dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);
      this.velocity = this.createDoubleFBO(simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);
      this.divergence = this.createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
      this.curl = this.createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
      this.pressure = this.createDoubleFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
    }

    calcDeltaTime() {
      const now = Date.now();
      let dt = (now - this.lastUpdateTime) / 1000;
      dt = Math.min(dt, 0.016666);
      this.lastUpdateTime = now;
      return dt;
    }

    weightedColor(palette) {
      const roll = Math.random();
      let acc = 0;
      for (const entry of palette) {
        acc += entry.weight;
        if (roll <= acc) return { ...entry.color };
      }
      return { ...palette[0].color };
    }

    random(min, max) {
      return min + Math.random() * (max - min);
    }

    pickBorderPoint(field, quote) {
      const edge = Math.floor(this.random(0, 4));
      const bleed = 34;
      if (edge === 0) {
        return {
          px: this.random(quote.left - bleed, quote.right + bleed) - field.left,
          py: this.random(quote.top - bleed, quote.top + bleed) - field.top
        };
      }
      if (edge === 1) {
        return {
          px: this.random(quote.left - bleed, quote.right + bleed) - field.left,
          py: this.random(quote.bottom - bleed, quote.bottom + bleed) - field.top
        };
      }
      if (edge === 2) {
        return {
          px: this.random(quote.left - bleed, quote.left + bleed) - field.left,
          py: this.random(quote.top - bleed, quote.bottom + bleed) - field.top
        };
      }
      return {
        px: this.random(quote.right - bleed, quote.right + bleed) - field.left,
        py: this.random(quote.top - bleed, quote.bottom + bleed) - field.top
      };
    }

    autoSplat() {
      if (!this.gl) return;
      const field = this.canvas.getBoundingClientRect();
      const quote = this.quoteElement.getBoundingClientRect();
      const ignition = performance.now() - this.startedAt < this.config.IGNITION_DURATION;
      const palette = ignition ? ignitionColors : settledColors;
      for (let i = 0; i < this.config.AUTO_SPLAT_COUNT; i++) {
        const point = ignition
          ? {
            px: this.random(quote.left, quote.right) - field.left,
            py: this.random(quote.top - 100, quote.bottom + 100) - field.top
          }
          : this.pickBorderPoint(field, quote);
        const x = point.px / field.width;
        const y = 1 - point.py / field.height;
        const forceScale = ignition ? 1 : 0.42;
        const dx = this.random(-50, 50) / field.width * this.config.SPLAT_FORCE * forceScale;
        const dy = this.random(-30, 30) / field.height * this.config.SPLAT_FORCE * forceScale;
        this.splat(x, y, dx, dy, this.weightedColor(palette), ignition ? this.config.IGNITION_COLOR_GAIN : 1);
      }
    }

    prefill() {
      if (!this.gl) return;
      const previousCount = this.config.AUTO_SPLAT_COUNT;
      this.config.AUTO_SPLAT_COUNT = this.config.INITIAL_SPLAT_COUNT;
      this.autoSplat();
      this.config.AUTO_SPLAT_COUNT = previousCount;
    }

    correctRadius(radius) {
      const aspectRatio = this.canvas.width / this.canvas.height;
      if (aspectRatio > 1) radius *= aspectRatio;
      return radius;
    }

    splat(x, y, dx, dy, color, gainMultiplier = 1) {
      const gl = this.gl;
      const splatProgram = this.splatProgram;
      splatProgram.bind();
      gl.uniform1i(splatProgram.uniforms.uTarget, this.velocity.read.attach(0));
      gl.uniform1f(splatProgram.uniforms.aspectRatio, this.canvas.width / this.canvas.height);
      gl.uniform2f(splatProgram.uniforms.point, x, y);
      gl.uniform3f(splatProgram.uniforms.color, dx, dy, 0);
      gl.uniform1f(splatProgram.uniforms.radius, this.correctRadius(this.config.SPLAT_RADIUS / 100));
      this.blit(this.velocity.write);
      this.velocity.swap();

      gl.uniform1i(splatProgram.uniforms.uTarget, this.dye.read.attach(0));
      gl.uniform3f(
        splatProgram.uniforms.color,
        color.r * 0.15 * this.config.COLOR_GAIN * gainMultiplier,
        color.g * 0.15 * this.config.COLOR_GAIN * gainMultiplier,
        color.b * 0.15 * this.config.COLOR_GAIN * gainMultiplier
      );
      this.blit(this.dye.write);
      this.dye.swap();
    }

    step(dt) {
      const gl = this.gl;
      gl.disable(gl.BLEND);

      this.curlProgram.bind();
      gl.uniform2f(this.curlProgram.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
      gl.uniform1i(this.curlProgram.uniforms.uVelocity, this.velocity.read.attach(0));
      this.blit(this.curl);

      this.vorticityProgram.bind();
      gl.uniform2f(this.vorticityProgram.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
      gl.uniform1i(this.vorticityProgram.uniforms.uVelocity, this.velocity.read.attach(0));
      gl.uniform1i(this.vorticityProgram.uniforms.uCurl, this.curl.attach(1));
      gl.uniform1f(this.vorticityProgram.uniforms.curl, this.config.CURL);
      gl.uniform1f(this.vorticityProgram.uniforms.dt, dt);
      this.blit(this.velocity.write);
      this.velocity.swap();

      this.divergenceProgram.bind();
      gl.uniform2f(this.divergenceProgram.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
      gl.uniform1i(this.divergenceProgram.uniforms.uVelocity, this.velocity.read.attach(0));
      this.blit(this.divergence);

      this.clearProgram.bind();
      gl.uniform1i(this.clearProgram.uniforms.uTexture, this.pressure.read.attach(0));
      gl.uniform1f(this.clearProgram.uniforms.value, this.config.PRESSURE);
      this.blit(this.pressure.write);
      this.pressure.swap();

      this.pressureProgram.bind();
      gl.uniform2f(this.pressureProgram.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
      gl.uniform1i(this.pressureProgram.uniforms.uDivergence, this.divergence.attach(0));
      for (let i = 0; i < this.config.PRESSURE_ITERATIONS; i++) {
        gl.uniform1i(this.pressureProgram.uniforms.uPressure, this.pressure.read.attach(1));
        this.blit(this.pressure.write);
        this.pressure.swap();
      }

      this.gradientSubtractProgram.bind();
      gl.uniform2f(this.gradientSubtractProgram.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
      gl.uniform1i(this.gradientSubtractProgram.uniforms.uPressure, this.pressure.read.attach(0));
      gl.uniform1i(this.gradientSubtractProgram.uniforms.uVelocity, this.velocity.read.attach(1));
      this.blit(this.velocity.write);
      this.velocity.swap();

      this.advectionProgram.bind();
      gl.uniform2f(this.advectionProgram.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
      if (!this.ext.supportLinearFiltering && this.advectionProgram.uniforms.dyeTexelSize) {
        gl.uniform2f(this.advectionProgram.uniforms.dyeTexelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
      }
      const velocityId = this.velocity.read.attach(0);
      gl.uniform1i(this.advectionProgram.uniforms.uVelocity, velocityId);
      gl.uniform1i(this.advectionProgram.uniforms.uSource, velocityId);
      gl.uniform1f(this.advectionProgram.uniforms.dt, dt);
      gl.uniform1f(this.advectionProgram.uniforms.dissipation, this.config.VELOCITY_DISSIPATION);
      gl.uniform1f(this.advectionProgram.uniforms.boundaryMinY, this.boundary.minY);
      gl.uniform1f(this.advectionProgram.uniforms.boundaryMaxY, this.boundary.maxY);
      gl.uniform1f(this.advectionProgram.uniforms.isVelocity, 1);
      this.blit(this.velocity.write);
      this.velocity.swap();

      if (!this.ext.supportLinearFiltering && this.advectionProgram.uniforms.dyeTexelSize) {
        gl.uniform2f(this.advectionProgram.uniforms.dyeTexelSize, this.dye.texelSizeX, this.dye.texelSizeY);
      }
      gl.uniform1i(this.advectionProgram.uniforms.uVelocity, this.velocity.read.attach(0));
      gl.uniform1i(this.advectionProgram.uniforms.uSource, this.dye.read.attach(1));
      gl.uniform1f(this.advectionProgram.uniforms.dissipation, this.config.DENSITY_DISSIPATION);
      gl.uniform1f(this.advectionProgram.uniforms.isVelocity, 0);
      this.blit(this.dye.write);
      this.dye.swap();
    }

    render(target = null) {
      const gl = this.gl;
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.BLEND);
      if (!target) {
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      const width = target ? target.width : gl.drawingBufferWidth;
      const height = target ? target.height : gl.drawingBufferHeight;
      this.displayMaterial.bind();
      if (this.config.SHADING && this.displayMaterial.uniforms.texelSize) {
        gl.uniform2f(this.displayMaterial.uniforms.texelSize, 1 / width, 1 / height);
      }
      gl.uniform1i(this.displayMaterial.uniforms.uTexture, this.dye.read.attach(0));
      this.blit(target);
    }

    start() {
      if (!this.gl || this.running) return;
      this.running = true;
      this.startedAt = performance.now();
      this.lastUpdateTime = Date.now();
      this.autoTimer = window.setInterval(() => this.autoSplat(), this.config.AUTO_SPLAT_INTERVAL);
      this.prefill();
      this.updateFrame();
    }

    stop() {
      this.running = false;
      window.clearInterval(this.autoTimer);
      this.autoTimer = null;
      if (this.animationId) cancelAnimationFrame(this.animationId);
    }

    updateFrame() {
      if (!this.running) return;
      const dt = this.calcDeltaTime();
      if (this.resizeCanvas()) this.initFramebuffers();
      this.updateBoundary();
      this.step(dt);
      this.render(null);
      this.animationId = requestAnimationFrame(() => this.updateFrame());
    }
  }

  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const mobileFallbackQuery = window.matchMedia("(max-width: 760px)");
  let smoke = null;
  let active = false;
  let settleTimer = null;

  function shouldUseFallback() {
    return mobileFallbackQuery.matches || reducedMotionQuery.matches;
  }

  function getSmoke() {
    if (shouldUseFallback()) return null;
    if (!smoke) smoke = new UtulekFluidField(canvas, quoteCard);
    return smoke;
  }

  function syncResponsiveMode() {
    if (!active) return;

    if (shouldUseFallback()) {
      if (smoke) smoke.stop();
      smokeField.classList.remove("is-active", "is-fading");
      fallbackHalo.classList.add("is-active");
      quoteCard.classList.add("is-settled");
      return;
    }

    const field = getSmoke();
    if (!field || !field.gl) return;
    fallbackHalo.classList.remove("is-active");
    smokeField.classList.remove("is-fading");
    smokeField.classList.add("is-active");
    field.start();
  }

  function addMediaQueryListener(query, callback) {
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", callback);
    } else if (typeof query.addListener === "function") {
      query.addListener(callback);
    }
  }

  function activate() {
    if (active) return;
    active = true;
    window.clearTimeout(settleTimer);
    quoteCard.classList.remove("is-settled");

    const field = getSmoke();

    if (!field || !field.gl) {
      fallbackHalo.classList.add("is-active");
      quoteCard.classList.add("is-settled");
      return;
    }

    fallbackHalo.classList.remove("is-active");
    smokeField.classList.remove("is-fading");
    smokeField.classList.add("is-active");
    field.start();
    settleTimer = window.setTimeout(() => {
      if (active) quoteCard.classList.add("is-settled");
    }, config.IGNITION_DURATION);
  }

  function deactivate() {
    if (!active) return;
    active = false;
    window.clearTimeout(settleTimer);
    quoteCard.classList.remove("is-settled");
    fallbackHalo.classList.remove("is-active");
    smokeField.classList.add("is-fading");
    smokeField.classList.remove("is-active");
    window.setTimeout(() => {
      if (!active && smoke) smoke.stop();
    }, 1500);
  }

  addMediaQueryListener(mobileFallbackQuery, syncResponsiveMode);
  addMediaQueryListener(reducedMotionQuery, syncResponsiveMode);

  window.pulsUtulek = {
    activate,
    deactivate,
    get isActive() {
      return active;
    }
  };
})();
