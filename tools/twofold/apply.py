import json, glob, sys, urllib.request, time
URL = "https://api.supabase.com/v1/projects/xqfevafhjbdulhcqcmao/database/query"
def q(sql):
    for t in range(4):
        try:
            r = urllib.request.Request(URL, data=json.dumps({"query": sql}).encode(), headers={"Content-Type": "application/json"}, method="POST")
            return json.loads(urllib.request.urlopen(r, timeout=120).read() or b"null")
        except Exception as e:
            err = e.read().decode()[:300] if hasattr(e, "read") else str(e); print("retry", t, err); time.sleep(2 * (t + 1))
    sys.exit("failed")
print(q("delete from public.ifm_docs where (coll='items' and id ~ '^i-twofold-[0-9]{2}(-v[0-9]{2})?$') or (coll='boundaries' and id like 'b-twofold-f%') returning coll").__len__(), "deleted")
for p in sorted(glob.glob("vbatch*.sql")):
    print(p, len(q(open(p).read())))
print(q("select coll, count(*), sum(octet_length(data::text))/1024 kb from public.ifm_docs group by coll order by coll"))
