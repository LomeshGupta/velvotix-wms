import re,glob,sys,collections
files=glob.glob('al/src/**/*.al',recursive=True)+glob.glob('al-test/src/**/*.al',recursive=True)
decl=re.compile(r'^\s*(table|page|codeunit|enum|interface|permissionset)\s+(?:(\d+)\s+)?"([^"]+)"',re.M)
objs={};ids=collections.defaultdict(list);errors=[]
src={f:open(f).read() for f in files}
for f,s in src.items():
    for m in decl.finditer(s):
        kind,id_,name=m.groups()
        objs[(kind,name)]=f
        if id_: ids[(kind if kind in('table','page','codeunit','enum','interface','permissionset') else kind, int(id_))].append(name)
# ids are unique per object type
for (k,i),names in ids.items():
    if len(names)>1: errors.append(f"duplicate {k} id {i}: {names}")
allids=[(i,n) for (k,i),ns in ids.items() for n in ns]
for i,n in allids:
    if not (50100<=i<=50249): errors.append(f"id {i} ({n}) outside 50100-50249")
# table fields
fields={}
for f,s in src.items():
    m=re.search(r'^\s*table\s+\d+\s+"([^"]+)"',s,re.M)
    if m:
        fields[m.group(1)]=set(re.findall(r'field\(\d+;\s*"?([^";]+?)"?;',s))
base={'Location','Item','Web Service','Warehouse Shipment Header','Warehouse Shipment Line','Web Service Management','Cryptography Management'}
# object references
ref=re.compile(r'\b(Record|Codeunit|Interface|Enum|page|Page|codeunit|tabledata|RunObject\s*=\s*page|SourceTable\s*=|LookupPageId\s*=|DrillDownPageId\s*=)\s*"([^"]+)"')
known={n for (_,n) in objs}
for f,s in src.items():
    # Option labels can be quoted (including "Codeunit"), but they are not object references.
    s_for_refs=re.sub(r"Option[^\n;]*;", "", s, flags=re.I)
    for m in ref.finditer(s_for_refs):
        n=m.group(2)
        if n not in known and n not in base: errors.append(f"{f}: unknown object \"{n}\"")
    for m in re.finditer(r'(?:TableRelation\s*=|SourceTable\s*=)\s*"?([A-Za-z ]+?)"?\s*;',s):
        n=m.group(1).strip()
        if n not in known and n not in base: errors.append(f"{f}: unknown relation {n}")
# field references: Var."Field" where Var declared Record "T"
for f,s in src.items():
    vars_=dict(re.findall(r'(\w+):\s*Record\s+"([^"]+)"',s))
    m0=re.search(r'SourceTable\s*=\s*"([^"]+)"',s)
    if m0: vars_['Rec']=m0.group(1)
    mt=re.search(r'^\s*table\s+\d+\s+"([^"]+)"',s,re.M)
    if mt: vars_['Rec']=mt.group(1)
    for v,fld in re.findall(r'\b(\w+)\."([^"]+)"',s):
        t=vars_.get(v)
        if t in fields and fld not in fields[t] and not fld.startswith('VWMS'):
            errors.append(f"{f}: {v}.\"{fld}\" not a field of {t}")
    methods={'Get','Insert','Modify','Delete','DeleteAll','ModifyAll','SetRange','SetFilter','FindSet','FindFirst','FindLast','Next','Count','IsEmpty','LockTable','Init','SetCurrentKey','Reset','GetSetup','GetBySystemId','Validate','SystemId','Copy','TransferFields','Find','CalcFields','Mark','SetView','GetFilter','SetRecFilter'}
    for v,fld in re.findall(r'\b(\w+)\.([A-Za-z_]\w*)\b',s):
        t=vars_.get(v)
        if t in fields and fld not in methods and fld not in fields[t] and not fld[0].isdigit():
            errors.append(f"{f}: {v}.{fld} not a field/method of {t}")
print("objects:",len(objs),"files:",len(files))
for e in sorted(set(errors)): print("ERR",e)
print("errors:",len(set(errors)))
