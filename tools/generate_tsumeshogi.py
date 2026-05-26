#!/usr/bin/env python3
"""
Tsumeshogi puzzle generator.
Generates easy.json (1-te), normal.json (3-te), hard.json (5-te).

App board format: board[row][col], row0=top(white), col0=left(file9)
Cell: {"t":"G","c":"b","p":false}
Solution: [{"drop":"G","to":[r,c]} OR {"from":[r,c],"to":[r,c],"promote":bool}]
"""

import shogi, json, random, os, sys

random.seed(42)

# ── Helpers ────────────────────────────────────────────────────────────────────

def usi_to_app(usi):
    if '*' in usi:
        p=usi[0]; fn=int(usi[2]); rc=usi[3]
        return {'drop':p,'to':[ord(rc)-ord('a'),9-fn]}
    ff=int(usi[0]);fr=usi[1];tf=int(usi[2]);tr=usi[3]
    m={'from':[ord(fr)-ord('a'),9-ff],'to':[ord(tr)-ord('a'),9-tf]}
    if len(usi)>4 and usi[4]=='+': m['promote']=True
    return m

def cell(t,c,p=False): return {'t':t,'c':c,'p':p}
def make_board(): return [[None]*9 for _ in range(9)]
def copy_board(b): return [row[:] for row in b]

def board_to_sfen(b9,hb,hw,turn='b'):
    rows=[]
    for row in b9:
        s='';empty=0
        for c in row:
            if c is None: empty+=1
            else:
                if empty: s+=str(empty);empty=0
                t=c['t'];col=c['c'];p=c.get('p',False)
                ch=('+'+t if p and t not in('K','G') else t)
                s+=(ch if col=='b' else ch.lower())
        if empty: s+=str(empty)
        rows.append(s)
    O='RBGSNLP';ps=[]
    for x in O:
        n=hb.get(x,0)
        if n: ps.append(('' if n==1 else str(n))+x)
    for x in O:
        n=hw.get(x,0)
        if n: ps.append(('' if n==1 else str(n))+x.lower())
    return '/'.join(rows)+f' {turn} {" ".join(ps) or "-"} 1'

# ── Solver ────────────────────────────────────────────────────────────────────

def find_mate(b,hm):
    if b.turn!=shogi.BLACK: return None
    for move in b.legal_moves:
        b.push(move)
        if not b.is_check(): b.pop();continue
        if b.is_checkmate():
            b.pop()
            if hm==1: return [move.usi()]
            else: continue
        if hm==1: b.pop();continue
        ok=True;bw=None;bc=None
        for wm in b.legal_moves:
            b.push(wm);res=find_mate(b,hm-2);b.pop()
            if res is None: ok=False;break
            if bw is None: bw=wm.usi();bc=res
        b.pop()
        if ok and bw: return [move.usi(),bw]+bc
    return None

def solve(ab,hb,hw,hm):
    sfen=board_to_sfen(ab,hb,hw)
    try: b=shogi.Board(sfen)
    except: return None
    if b.turn!=shogi.BLACK or b.is_check(): return None
    return find_mate(b,hm)

# ── Entry builder ─────────────────────────────────────────────────────────────

def make_entry(pid,ab,hb,hw,sol_usi,mn):
    bj=[[({'t':c['t'],'c':c['c'],'p':c.get('p',False)} if c else None) for c in row] for row in ab]
    sa=[usi_to_app(u) for u in sol_usi]
    hint=sa[0].get('to',[0,0])
    dm={1:'Easy',3:'Normal',5:'Hard'}[mn]
    tja={1:'1手詰み',3:'3手詰み',5:'5手詰み'}[mn]
    ten={1:'Mate in 1',3:'Mate in 3',5:'Mate in 5'}[mn]
    dja={1:'1手で詰ませてください。',3:'3手で詰ませてください。',5:'5手で詰ませてください。'}[mn]
    den={1:'Checkmate in 1.',3:'Checkmate in 3.',5:'Checkmate in 5.'}[mn]
    return {'id':pid,'difficulty':dm,'mate':mn,'turn':'b','titleJa':tja,'titleEn':ten,
            'descJa':f"先手番です。{dja}",'descEn':f"Black to move. {den}",
            'board':bj,'hand':{'b':dict(hb),'w':dict(hw)},
            'solution':sa,'hint':hint,'sfen':board_to_sfen(ab,hb,hw),'moves':sol_usi}

# ── 1-te generation ───────────────────────────────────────────────────────────

def gen_1te(target=120):
    puzs=[];seen=set()
    BKR,BKC=8,4

    def add(board,hb,hw=None):
        if len(puzs)>=target: return
        if hw is None: hw={}
        sfen=board_to_sfen(board,hb,hw)
        if sfen in seen: return
        seen.add(sfen)
        sol=solve(board,hb,hw,1)
        if sol: puzs.append((copy_board(board),dict(hb),dict(hw),sol,1))

    def done(): return len(puzs)>=target

    # Enumerate candidate boards, stop early when target reached.
    # Pattern: King on upper rows, black rook(s) on board, hand piece for delivery.

    # ── P1: row-0 king, ONE black rook at diagonal (kc+dc, row1) ────────────
    for kc in range(0,9):
        for rdc in [-1,1]:
            if done(): break
            rc=kc+rdc
            if not(0<=rc<=8): continue
            for ht in ['G','S','R','B','L']:
                if done(): break
                # Base
                b=make_board()
                b[0][kc]=cell('K','w');b[1][rc]=cell('R','b');b[BKR][BKC]=cell('K','b')
                add(b,{ht:1})
                if done(): break
                # Add white pieces at row-0 neighbors (not king square)
                for wdc in [-2,-1,1,2]:
                    wc=kc+wdc
                    if not(0<=wc<=8) or wc==kc: continue
                    for wt in ['G','S','P']:
                        if done(): break
                        b2=copy_board(b)
                        if b2[0][wc] is not None: continue
                        b2[0][wc]=cell(wt,'w')
                        add(b2,{ht:1})
                        if ht!='G': add(b2,{'G':1,ht:1})

    print(f"[1-te] After P1 (row-0 1-rook): {len(puzs)}",flush=True)

    # ── P2: row-0 king, TWO black rooks at (row1, kc-1) and (row1, kc+1) ───
    for kc in range(1,8):
        if done(): break
        b=make_board()
        b[0][kc]=cell('K','w');b[1][kc-1]=cell('R','b');b[1][kc+1]=cell('R','b')
        b[BKR][BKC]=cell('K','b')
        for ht in ['G','S','R','B']:
            if done(): break
            add(b,{ht:1})
        for wdc in [-2,-1,1,2]:
            wc=kc+wdc
            if not(0<=wc<=8) or wc==kc: continue
            b2=copy_board(b)
            if b2[0][wc] is not None: continue
            b2[0][wc]=cell('G','w')
            for ht in ['G','S','R']:
                if done(): break
                add(b2,{ht:1})

    print(f"[1-te] After P2 (row-0 2-rook): {len(puzs)}",flush=True)

    # ── P3: row-1 king, rook at (row2, kc+dc), white golds above ────────────
    for kc in range(0,9):
        if done(): break
        for rdc in [-1,1]:
            if done(): break
            rc=kc+rdc
            if not(0<=rc<=8): continue
            b=make_board()
            b[1][kc]=cell('K','w');b[2][rc]=cell('R','b');b[BKR][BKC]=cell('K','b')
            # Block upper row
            for dc in [-1,0,1]:
                wc=kc+dc
                if 0<=wc<=8 and b[0][wc] is None:
                    b[0][wc]=cell('G','w')
            for ht in ['G','S','R']:
                if done(): break
                add(b,{ht:1})
            # Partial blocking variants (remove one upper piece)
            for omit_dc in [-1,0,1]:
                if done(): break
                oc=kc+omit_dc
                if not(0<=oc<=8): continue
                b2=copy_board(b)
                b2[0][oc]=None
                for ht in ['G','S']:
                    if done(): break
                    add(b2,{ht:1})
                    add(b2,{'G':1,'S':1})

    print(f"[1-te] After P3 (row-1 1-rook): {len(puzs)}",flush=True)

    # ── P4: row-0 king, bishop on board, hand pieces ────────────────────────
    for kc in range(1,8):
        if done(): break
        for bdc in [-2,-1,1,2]:
            if done(): break
            bc_col=kc+bdc; bc_row=abs(bdc)
            if not(0<=bc_col<=8 and 1<=bc_row<=3): continue
            b=make_board()
            b[0][kc]=cell('K','w');b[bc_row][bc_col]=cell('B','b');b[BKR][BKC]=cell('K','b')
            for dc in [-1,0,1]:
                wc=kc+dc
                if wc!=kc and 0<=wc<=8 and b[0][wc] is None:
                    b[0][wc]=cell('G','w')
            for ht in ['G','S','R','B']:
                if done(): break
                add(b,{ht:1})

    print(f"[1-te] After P4 (bishop): {len(puzs)}",flush=True)

    # ── P5: fully-surrounded king (row 1-3), various hand pieces ─────────────
    for kr in range(0,3):
        if done(): break
        for kc in range(0,9):
            if done(): break
            b=make_board()
            b[kr][kc]=cell('K','w');b[BKR][BKC]=cell('K','b')
            # Fill all adjacents with white golds
            for dr in [-1,0,1]:
                for dc in [-1,0,1]:
                    if dr==0 and dc==0: continue
                    r,c=kr+dr,kc+dc
                    if 0<=r<=8 and 0<=c<=8 and b[r][c] is None:
                        b[r][c]=cell('G','w')
            for ht in ['G','S','R','B','L','N']:
                if done(): break
                add(b,{ht:1})

    print(f"[1-te] After P5 (surrounded): {len(puzs)}",flush=True)

    if not done():
        print(f"[1-te] WARNING: only {len(puzs)} puzzles found",flush=True)
    random.shuffle(puzs)
    return puzs[:target]

# ── 3-te generation ───────────────────────────────────────────────────────────

def gen_3te(p1,target=120):
    res=[];seen=set()
    BKR,BKC=8,4

    def add3(board,hb,hw=None):
        if len(res)>=target: return
        if hw is None: hw={}
        sfen=board_to_sfen(board,hb,hw)
        if sfen in seen: return
        seen.add(sfen)
        sol=solve(board,hb,hw,3)
        if sol and len(sol)==3: res.append((copy_board(board),dict(hb),dict(hw),sol,3))

    # 1-step backward extension from 1-te
    print("[3-te] Backward extension from 1-te...",flush=True)
    for (b1,hb,hw,_,_) in p1:
        if len(res)>=target: break
        wkr=wkc=None
        for r in range(9):
            for c in range(9):
                if b1[r][c] and b1[r][c]['t']=='K' and b1[r][c]['c']=='w':
                    wkr,wkc=r,c;break
            if wkr is not None: break
        if wkr is None: continue
        for dr in [-1,0,1]:
            for dc in [-1,0,1]:
                if len(res)>=target: break
                if dr==0 and dc==0: continue
                nr,nc=wkr+dr,wkc+dc
                if not(0<=nr<=8 and 0<=nc<=8): continue
                if b1[nr][nc] is not None: continue
                nb=copy_board(b1);nb[nr][nc]=nb[wkr][wkc];nb[wkr][wkc]=None
                add3(nb,hb,hw)
    print(f"  → {len(res)}",flush=True)

    # Direct templates if still need more
    if len(res)<target:
        print("[3-te] Direct templates...",flush=True)
        for kr in range(0,3):
            for kc in range(0,9):
                if len(res)>=target: break
                for esc_dc in [-1,1]:
                    if len(res)>=target: break
                    esc_c=kc+esc_dc
                    if not(0<=esc_c<=8): continue
                    b=make_board();b[kr][kc]=cell('K','w');b[BKR][BKC]=cell('K','b')
                    for dr in [-1,0,1]:
                        for dc in [-1,0,1]:
                            if dr==0 and dc==0: continue
                            if dr==0 and dc==esc_dc: continue
                            r,c=kr+dr,kc+dc
                            if 0<=r<=8 and 0<=c<=8 and b[r][c] is None:
                                b[r][c]=cell('G','w')
                    for hb in [{'R':1,'G':1},{'G':2},{'G':1,'S':1},{'B':1,'G':1}]:
                        if len(res)>=target: break
                        add3(b,hb)
        print(f"  → {len(res)}",flush=True)

    random.shuffle(res)
    return res[:target]

# ── 5-te generation ───────────────────────────────────────────────────────────

def gen_5te(p3,target=120):
    res=[];seen=set()
    BKR,BKC=8,4

    def add5(board,hb,hw=None):
        if len(res)>=target: return
        if hw is None: hw={}
        sfen=board_to_sfen(board,hb,hw)
        if sfen in seen: return
        seen.add(sfen)
        sol=solve(board,hb,hw,5)
        if sol and len(sol)==5: res.append((copy_board(board),dict(hb),dict(hw),sol,5))

    # 1-step backward from 3-te (main source)
    print("[5-te] Backward extension from 3-te...",flush=True)
    for (b3,hb,hw,_,_) in p3:
        if len(res)>=target: break
        wkr=wkc=None
        for r in range(9):
            for c in range(9):
                if b3[r][c] and b3[r][c]['t']=='K' and b3[r][c]['c']=='w':
                    wkr,wkc=r,c;break
            if wkr is not None: break
        if wkr is None: continue
        for dr in [-1,0,1]:
            for dc in [-1,0,1]:
                if len(res)>=target: break
                if dr==0 and dc==0: continue
                nr,nc=wkr+dr,wkc+dc
                if not(0<=nr<=8 and 0<=nc<=8): continue
                if b3[nr][nc] is not None: continue
                nb=copy_board(b3);nb[nr][nc]=nb[wkr][wkc];nb[wkr][wkc]=None
                add5(nb,hb,hw)
    print(f"  → {len(res)}",flush=True)

    # Direct templates if needed
    if len(res)<target:
        print("[5-te] Direct templates...",flush=True)
        for kr in range(0,2):
            for kc in range(1,8):
                if len(res)>=target: break
                b=make_board();b[kr][kc]=cell('K','w');b[BKR][BKC]=cell('K','b')
                for dr in [-1,0,1]:
                    for dc in [-1,0,1]:
                        if dr==0 and dc==0: continue
                        if dr==0 and dc in[-1,1]: continue
                        r,c=kr+dr,kc+dc
                        if 0<=r<=8 and 0<=c<=8 and b[r][c] is None:
                            b[r][c]=cell('G','w')
                for hb in [{'R':1,'G':2},{'G':3},{'R':2,'G':1},{'B':1,'G':2}]:
                    if len(res)>=target: break
                    add5(b,hb)
        print(f"  → {len(res)}",flush=True)

    random.shuffle(res)
    return res[:target]

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    TARGET=120
    out=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','public','puzzles','shogi')
    os.makedirs(out,exist_ok=True)

    print("=== 1-te (Easy) ===",flush=True)
    p1=gen_1te(TARGET)
    j1=[make_entry(f"tsume_easy_{i+1:03d}",b,cb,cw,sol,1) for i,(b,cb,cw,sol,_) in enumerate(p1)]
    with open(os.path.join(out,'easy.json'),'w',encoding='utf-8') as f: json.dump(j1,f,ensure_ascii=False,indent=2)
    print(f"Wrote easy.json: {len(j1)} puzzles",flush=True)

    print("\n=== 3-te (Normal) ===",flush=True)
    p3=gen_3te(p1,TARGET)
    j3=[make_entry(f"tsume_normal_{i+1:03d}",b,cb,cw,sol,3) for i,(b,cb,cw,sol,_) in enumerate(p3)]
    with open(os.path.join(out,'normal.json'),'w',encoding='utf-8') as f: json.dump(j3,f,ensure_ascii=False,indent=2)
    print(f"Wrote normal.json: {len(j3)} puzzles",flush=True)

    print("\n=== 5-te (Hard) ===",flush=True)
    p5=gen_5te(p3,TARGET)
    j5=[make_entry(f"tsume_hard_{i+1:03d}",b,cb,cw,sol,5) for i,(b,cb,cw,sol,_) in enumerate(p5)]
    with open(os.path.join(out,'hard.json'),'w',encoding='utf-8') as f: json.dump(j5,f,ensure_ascii=False,indent=2)
    print(f"Wrote hard.json: {len(j5)} puzzles",flush=True)

    print(f"\nTotal: easy={len(j1)}, normal={len(j3)}, hard={len(j5)}",flush=True)

if __name__=='__main__':
    main()
