"""Replace the old TWOFOLD film rows with hbatch*.sql (from build_helix_rows.py)."""
import json, glob, os, sys, urllib.request, time
HERE = os.path.dirname(os.path.abspath(__file__))
URL = "https://api.supabase.com/v1/projects/xqfevafhjbdulhcqcmao/database/query"
def q(sql):
    for t in range(4):
        try:
            r = urllib.request.Request(URL, data=json.dumps({"query": sql}).encode(), headers={"Content-Type": "application/json"}, method="POST")
            return json.loads(urllib.request.urlopen(r, timeout=180).read() or b"null")
        except Exception as e:
            print("retry", t, e.read().decode()[:300] if hasattr(e, "read") else e); time.sleep(2 * (t + 1))
    sys.exit("failed")
print(len(q("delete from public.ifm_docs where (coll='items' and id like 'i-twofold-%') or (coll='boundaries' and id like 'b-twofold-f%') "
            "or (coll='events' and id like 'e-twofold-%') or (coll='places' and id like 'p-twofold-path-%') returning id")), "old rows removed")
q("update public.ifm_docs set data = data || '{\"ghost\":true}'::jsonb where coll='boundaries' and id='b-twofold'")
for p in sorted(glob.glob(os.path.join(HERE, "hbatch*.sql"))):
    print(os.path.basename(p), len(q(open(p).read())))
print(q("select coll, count(*), sum(octet_length(data::text))/1024 kb from public.ifm_docs group by coll order by coll"))
