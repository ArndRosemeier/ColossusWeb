from pathlib import Path
from PIL import Image
import json,hashlib,numpy as np

ROOT=Path(__file__).resolve().parent
names=[['Plains','Brush','Jungle','Woods'],['Marsh','Swamp','Hills','Mountains'],['Desert','Tundra','Tower','Abyss']]
sheet=Image.open(ROOT/'terrain-sheet-v1.png').convert('RGBA')
alpha=np.asarray(sheet)[:,:,3]
assert alpha.min()==0 and alpha.max()==255
records=[]
for col in range(4):
 x0,x1=round(col*sheet.width/4),round((col+1)*sheet.width/4)
 projection=(alpha[:,x0:x1]>8).any(axis=1)
 cuts=[0]
 for nominal in [sheet.height/3,2*sheet.height/3]:
  candidates=[];start=None
  for y in range(max(0,int(nominal)-90),min(sheet.height,int(nominal)+90)):
   if not projection[y] and start is None:start=y
   if projection[y] and start is not None:candidates.append((start,y));start=None
  if start is not None:candidates.append((start,min(sheet.height,int(nominal)+90)))
  candidates=[r for r in candidates if r[1]-r[0]>=5]
  assert candidates,(col,nominal,'no complete white gutter')
  best=max(candidates,key=lambda r:r[1]-r[0]);cuts.append(round(sum(best)/2))
 cuts.append(sheet.height)
 for row in range(3):
  box=(x0,cuts[row],x1,cuts[row+1]);cell=sheet.crop(box)
  mask=cell.getchannel('A').point(lambda v:255 if v>8 else 0);b=mask.getbbox();assert b
  # Transparent padding transports the existing feathered edges; no repainting.
  b=(max(0,b[0]-6),max(0,b[1]-6),min(cell.width,b[2]+6),min(cell.height,b[3]+6))
  content=(box[0]+b[0],box[1]+b[1],box[0]+b[2],box[1]+b[3])
  records.append({'name':names[row][col],'sourceBox':box,'contentBox':content})
maxedge=max(max(r['contentBox'][2]-r['contentBox'][0],r['contentBox'][3]-r['contentBox'][1]) for r in records)
scale=224/maxedge
output=ROOT/'terrain-v1';output.mkdir(exist_ok=True)
for r in records:
 art=sheet.crop(r['contentBox']);art=art.resize((round(art.width*scale),round(art.height*scale)),Image.Resampling.LANCZOS)
 frame=Image.new('RGBA',(256,256),(0,0,0,0));frame.alpha_composite(art,((256-art.width)//2,236-art.height))
 box=frame.getchannel('A').point(lambda v:255 if v>8 else 0).getbbox();assert min(box[0],box[1],256-box[2],256-box[3])>=8,(r['name'],box)
 path=output/(r['name']+'.png');frame.save(path,optimize=True)
 r.update(file=path.name,size=path.stat().st_size,sha256=hashlib.sha256(path.read_bytes()).hexdigest(),visibleBounds=box)
meta={'method':'Built-in image_gen transparent full-frame terrain drawings; measured transparent-gutter crop, uniform scale and alpha-preserving delivery packaging only. No repainting or generated pixel edits.', 'sourceSheetSha256':hashlib.sha256((ROOT/'terrain-sheet-v1.png').read_bytes()).hexdigest(),'sourceSize':sheet.size,'frameSize':256,'commonScale':scale,'terrains':sorted(records,key=lambda r:r['name'])}
(ROOT/'terrain-v1.provenance.json').write_text(json.dumps(meta,indent=2))
print(json.dumps({'sourceSize':sheet.size,'terrains':len(records),'totalBytes':sum(r['size'] for r in records),'frameSize':256,'allSafeAlphaMargins':True},indent=2))
