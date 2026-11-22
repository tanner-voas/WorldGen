"""Optional Linux/Mesa OpenGL ES 3 smoke test (requires NumPy and Node).
Run from any directory with: python3 tests/shader-smoke.py
Tests real shader compilation and pixels; not part of npm test or a Safari test.
"""
import ctypes as c, os, json, subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[1]
shaders=json.loads(subprocess.check_output(['node','--input-type=module','-e',
 "import {TERRAIN_VERTEX_SHADER as v,TERRAIN_FRAGMENT_SHADER as f} from './src/terrain-3d.js'; console.log(JSON.stringify([v,f]));"],cwd=root))
os.environ['EGL_PLATFORM']='surfaceless'; os.environ['LIBGL_ALWAYS_SOFTWARE']='1'
E=c.CDLL('libEGL.so.1'); I=c.c_int; P=c.c_void_p; U=c.c_uint; B=c.c_char_p
for name,rest,args in [('eglGetDisplay',P,[P]),('eglInitialize',U,[P,c.POINTER(I),c.POINTER(I)]),('eglChooseConfig',U,[P,c.POINTER(I),c.POINTER(P),I,c.POINTER(I)]),('eglBindAPI',U,[U]),('eglCreatePbufferSurface',P,[P,P,c.POINTER(I)]),('eglCreateContext',P,[P,P,P,c.POINTER(I)]),('eglMakeCurrent',U,[P,P,P,P]),('eglGetProcAddress',P,[B]),('eglGetError',U,[])]:
 f=getattr(E,name);f.restype=rest;f.argtypes=args
D=E.eglGetDisplay(None); major=I();minor=I();assert E.eglInitialize(D,c.byref(major),c.byref(minor)),hex(E.eglGetError())
assert E.eglBindAPI(0x30A0)
attrs=(I*13)(0x3033,1,0x3040,0x40,0x3024,8,0x3023,8,0x3022,8,0x3025,16,0x3038);cfg=P();n=I();assert E.eglChooseConfig(D,attrs,c.byref(cfg),1,c.byref(n)) and n.value
surf=E.eglCreatePbufferSurface(D,cfg,(I*5)(0x3057,256,0x3056,256,0x3038));assert surf
ctx=E.eglCreateContext(D,cfg,None,(I*3)(0x3098,3,0x3038));assert ctx
assert E.eglMakeCurrent(D,surf,surf,ctx)
def fn(name,r,*args):
 addr=E.eglGetProcAddress(name.encode());assert addr,name
 return c.CFUNCTYPE(r,*args)(addr)
glGetString=fn('glGetString',B,U);print(glGetString(0x1f02),glGetString(0x1f01))
create=fn('glCreateShader',U,U);source=fn('glShaderSource',None,U,I,c.POINTER(B),c.POINTER(I));compile=fn('glCompileShader',None,U);status=fn('glGetShaderiv',None,U,U,c.POINTER(I));log=fn('glGetShaderInfoLog',None,U,I,c.POINTER(I),P)
program=fn('glCreateProgram',U)(); attach=fn('glAttachShader',None,U,U)
for kind,shader in zip((0x8b31,0x8b30),shaders):
 sh=create(kind);s=B(shader.encode());source(sh,1,c.byref(s),None);compile(sh);ok=I();status(sh,0x8b81,c.byref(ok));buf=c.create_string_buffer(8192);log(sh,len(buf),None,buf);print(hex(kind),ok.value,buf.value.decode());assert ok.value;attach(program,sh)
fn('glLinkProgram',None,U)(program);ok=I();fn('glGetProgramiv',None,U,U,c.POINTER(I))(program,0x8b82,c.byref(ok));buf=c.create_string_buffer(8192);fn('glGetProgramInfoLog',None,U,I,c.POINTER(I),P)(program,len(buf),None,buf);print('link',ok.value,buf.value.decode());assert ok.value
import numpy as np
use=fn('glUseProgram',None,U);use(program)
loc=fn('glGetUniformLocation',I,U,B)
u1i=fn('glUniform1i',None,I,I);u1f=fn('glUniform1f',None,I,c.c_float);u2f=fn('glUniform2f',None,I,c.c_float,c.c_float);u3f=fn('glUniform3f',None,I,c.c_float,c.c_float,c.c_float)
def seti(name,v):u1i(loc(program,name.encode()),v)
def setf(name,v):u1f(loc(program,name.encode()),v)
mat=np.array([1,0,0,0,0,0,-.1,0,0,1,0,0,0,0,0,1],np.float32)
fn('glUniformMatrix4fv',None,I,I,c.c_ubyte,P)(loc(program,b'uCamera'),1,0,mat.ctypes.data)
setf('uHeightMultiplier',1);setf('uSeaLevel',0);setf('uMaterialStrength',.88);setf('uWorldScale',.05);setf('uBaseHeightScale',.02)
u2f(loc(program,b'uPlane'),2,2);u3f(loc(program,b'uEye'),0,3,0)
seti('uMorphMode',0);seti('uWater',0);seti('uTerrainFields',0);seti('uMaterialFields',1);seti('uSurfaceMaterials',2)
# X,Z quad with identical vertex colors; only surface coverage changes.
verts=np.array([[-1,0,-1,0,1,0,.4,.55,.55,.55],[1,0,-1,0,1,0,.4,.55,.55,.55],[-1,0,1,0,1,0,.4,.55,.55,.55],[1,0,1,0,1,0,.4,.55,.55,.55]],np.float32)
vao=U();fn('glGenVertexArrays',None,I,c.POINTER(U))(1,c.byref(vao));fn('glBindVertexArray',None,U)(vao)
vbo=U();fn('glGenBuffers',None,I,c.POINTER(U))(1,c.byref(vbo));fn('glBindBuffer',None,U,U)(0x8892,vbo);fn('glBufferData',None,U,c.c_ssize_t,P,U)(0x8892,verts.nbytes,verts.ctypes.data,0x88e4)
for i,size,offset in [(0,3,0),(1,3,12),(2,1,24),(3,3,28)]:
 fn('glEnableVertexAttribArray',None,U)(i);fn('glVertexAttribPointer',None,U,I,U,c.c_ubyte,I,P)(i,size,0x1406,0,40,offset)
textures=(U*3)();fn('glGenTextures',None,I,c.POINTER(U))(3,textures)
active=fn('glActiveTexture',None,U);bind=fn('glBindTexture',None,U,U);param=fn('glTexParameteri',None,U,U,I);image=fn('glTexImage3D',None,U,I,I,I,I,I,I,U,U,P)
for i,t in enumerate(textures):
 active(0x84c0+i);bind(0x8c1a,t)
 for p in (0x2801,0x2800):param(0x8c1a,p,0x2601 if i==2 else 0x2600)
 for p in (0x2802,0x2803):param(0x8c1a,p,0x812f)
 if i<2:
  data=np.zeros((2,1,1,4),np.float32);image(0x8c1a,0,0x8814,1,1,2,0,0x1908,0x1406,data.ctypes.data)
fn('glViewport',None,I,I,I,I)(0,0,256,256)
draw=fn('glDrawArrays',None,U,I,I);read=fn('glReadPixels',None,I,I,I,I,U,U,P)
images=[]
for k in range(8):
 data=np.zeros((2,1,1,4),np.uint8);data[k//4,0,0,k%4]=255
 active(0x84c2);bind(0x8c1a,textures[2]);image(0x8c1a,0,0x8058,1,1,2,0,0x1908,0x1401,data.ctypes.data)
 draw(0x0005,0,4);pixels=np.zeros((256,256,4),np.uint8);read(0,0,256,256,0x1908,0x1401,pixels.ctypes.data)
 err=fn('glGetError',U)();assert err==0,hex(err)
 arr=pixels[:,:,:3];print('material',k,'mean',arr.mean(axis=(0,1)),'std',arr.std(axis=(0,1)));assert arr.max()>20
 if k<7: assert arr.std(axis=(0,1)).max()>0.1
 images.append(arr[::-1].copy())
assert len({im.tobytes() for im in images})==8
# Water shader must be independent of material coverage.
seti('uWater',2);draw(0x0005,0,4);a=np.zeros((256,256,4),np.uint8);read(0,0,256,256,0x1908,0x1401,a.ctypes.data)
data=np.array([255,0,0,0,0,0,0,0],np.uint8);image(0x8c1a,0,0x8058,1,1,2,0,0x1908,0x1401,data.ctypes.data)
draw(0x0005,0,4);b=np.zeros_like(a);read(0,0,256,256,0x1908,0x1401,b.ctypes.data);assert np.array_equal(a,b)
print('PASS distinct material pixel outputs and invariant river shader')

# Exercise optical depth, relief invariance and actual lighting on a quad.
def render():
 draw(0x0005,0,4);pixels=np.zeros((256,256,4),np.uint8)
 read(0,0,256,256,0x1908,0x1401,pixels.ctypes.data)
 err=fn('glGetError',U)();assert err==0,hex(err)
 return pixels

def set_bed(depth):
 active(0x84c0);bind(0x8c1a,textures[0]);data=np.zeros((1,2,2,4),np.float32)
 data[:,:,:,0]=.5-depth
 image(0x8c1a,0,0x8814,2,2,1,0,0x1908,0x1406,data.ctypes.data)

def upload_vertices():
 fn('glBindBuffer',None,U,U)(0x8892,vbo)
 fn('glBufferData',None,U,c.c_ssize_t,P,U)(0x8892,verts.nbytes,verts.ctypes.data,0x88e4)

# Nonzero lake/sea datum: level is .5 in stored units, not zero.
verts[:,1]=.01;upload_vertices();seti('uHasDepthField',1)
for kind in (1,3):
 seti('uWater',kind);set_bed(.001);shallow=render();set_bed(.8);deep=render()
 assert shallow[:,:,:3].mean()>deep[:,:,:3].mean()+15,(kind,shallow.mean(),deep.mean())
 assert np.all(shallow[:,:,3]==255) and np.all(deep[:,:,3]==255)
 print('water',kind,'shallow/deep RGB mean',shallow[:,:,:3].mean(),deep[:,:,:3].mean())
 # Keep camera-to-surface vector identical when changing visual relief.
 setf('uHeightMultiplier',3);u3f(loc(program,b'uEye'),0,3.02,0)
 scaled=render();assert np.max(np.abs(scaled.astype(int)-deep.astype(int)))<=1
 setf('uHeightMultiplier',1);u3f(loc(program,b'uEye'),0,3,0)
 # When the base field is absent, the fallback is still opaque and nonblack.
 seti('uHasDepthField',0);fallback=render();assert fallback[:,:,:3].mean()>10
 seti('uHasDepthField',1)
# Opposite slopes under the same sun; material and texture stay fixed.
seti('uWater',0);verts[:,1]=0
sun=np.array([-.52,.80,.32]);sun/=np.linalg.norm(sun)
verts[:,3:6]=sun;upload_vertices();lit=render()
verts[:,3:6]=[.52,.2,-.32];upload_vertices();shadow=render()
assert lit[:,:,:3].mean()>shadow[:,:,:3].mean()+15
print('lit/shadow RGB mean',lit[:,:,:3].mean(),shadow[:,:,:3].mean())
# Grazing, distant air should decrease contrast with the atmospheric color.
u3f(loc(program,b'uEye'),0,.3,12);distant=render()
assert np.mean(np.abs(distant[:,:,:3].astype(float)-shadow[:,:,:3]))>3
print('PASS depth-dependent ocean/lake shading, relief invariance, lighting and haze')
