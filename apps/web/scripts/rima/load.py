import json, math
R='raw/'
LAT0=-10.95; KX=111320*math.cos(math.radians(LAT0)); KY=110574
def xy(lon,lat): return ((lon+37.06)*KX, -(lat-LAT0)*KY)  # metros: x leste, y sul
def els(n): return json.load(open(R+n+'.json'))['elements']
def way_pts(e): return [xy(p['lon'],p['lat']) for p in e.get('geometry',[]) if p]
def rel_rings(e):
    outs=[]; segs=[[xy(p['lon'],p['lat']) for p in m['geometry']] for m in e.get('members',[]) if m['type']=='way' and m.get('role','outer') in ('outer','') and m.get('geometry')]
    # junta segmentos em anéis
    rings=[]
    while segs:
        cur=segs.pop(0)
        changed=True
        while changed and cur[0]!=cur[-1]:
            changed=False
            for i,s in enumerate(segs):
                if s[0]==cur[-1]: cur+=s[1:]; segs.pop(i); changed=True; break
                if s[-1]==cur[-1]: cur+=s[::-1][1:]; segs.pop(i); changed=True; break
                if s[-1]==cur[0]: cur=s+cur[1:]; segs.pop(i); changed=True; break
                if s[0]==cur[0]: cur=s[::-1]+cur[1:]; segs.pop(i); changed=True; break
        rings.append(cur)
    return rings
