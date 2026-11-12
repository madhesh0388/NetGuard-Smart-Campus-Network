from flask import Flask, render_template, jsonify, request
from datetime import datetime
from threading import Lock
import sqlite3, random, os, time

app = Flask(__name__)
DB = os.path.join(app.root_path, "data", "netguard.db")
lock = Lock()
simulation_running = False

DEVICES = [
    {"id":"GW-01","name":"Internet Gateway","type":"Gateway","department":"Infrastructure","parent":None,"status":"Online","bandwidth":38,"capacity":1000,"latency":8,"loss":0.1},
    {"id":"RTR-01","name":"Core Router","type":"Router","department":"Infrastructure","parent":"GW-01","status":"Online","bandwidth":52,"capacity":1000,"latency":12,"loss":0.2},
    {"id":"SW-01","name":"Core Switch A","type":"Switch","department":"Infrastructure","parent":"RTR-01","status":"Online","bandwidth":61,"capacity":1000,"latency":4,"loss":0.1},
    {"id":"SW-02","name":"Core Switch B","type":"Switch","department":"Infrastructure","parent":"RTR-01","status":"Online","bandwidth":47,"capacity":1000,"latency":5,"loss":0.1},
    {"id":"AP-ECE","name":"ECE Access Point","type":"Wi-Fi AP","department":"ECE","parent":"SW-01","status":"Online","bandwidth":44,"capacity":300,"latency":18,"loss":0.3},
    {"id":"LAB-ECE","name":"ECE Computer Lab","type":"Lab","department":"ECE","parent":"AP-ECE","status":"Online","bandwidth":56,"capacity":500,"latency":20,"loss":0.2},
    {"id":"AP-CSE","name":"CSE Access Point","type":"Wi-Fi AP","department":"CSE","parent":"SW-01","status":"Online","bandwidth":67,"capacity":300,"latency":22,"loss":0.4},
    {"id":"LAB-CSE","name":"CSE Computer Lab","type":"Lab","department":"CSE","parent":"AP-CSE","status":"Online","bandwidth":72,"capacity":500,"latency":25,"loss":0.5},
    {"id":"AP-EEE","name":"EEE Access Point","type":"Wi-Fi AP","department":"EEE","parent":"SW-02","status":"Online","bandwidth":35,"capacity":300,"latency":16,"loss":0.2},
    {"id":"SRV-ERP","name":"College ERP Server","type":"Server","department":"Administration","parent":"SW-02","status":"Online","bandwidth":28,"capacity":500,"latency":6,"loss":0.1},
    {"id":"SRV-LMS","name":"Learning Server","type":"Server","department":"Academic","parent":"SW-02","status":"Online","bandwidth":41,"capacity":500,"latency":7,"loss":0.1},
    {"id":"LIB-AP","name":"Library Access Point","type":"Wi-Fi AP","department":"Library","parent":"SW-02","status":"Online","bandwidth":31,"capacity":300,"latency":17,"loss":0.2},
]
events = []
faults = []
scenario_state = {"last":"No scenario run yet","result":"Choose a what-if scenario to see its impact."}

def connect():
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    return con

def init_db():
    os.makedirs(os.path.dirname(DB), exist_ok=True)
    with connect() as con:
        con.execute("""CREATE TABLE IF NOT EXISTS events(
            id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT, category TEXT, message TEXT, severity TEXT)""")
        con.execute("""CREATE TABLE IF NOT EXISTS recoveries(
            id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT, device_id TEXT, action TEXT, result TEXT)""")
        con.execute("""CREATE TABLE IF NOT EXISTS incidents(
            id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT, title TEXT, details TEXT, status TEXT)""")
        con.commit()

def log_event(category, message, severity="info"):
    stamp = datetime.now().strftime("%H:%M:%S")
    events.insert(0, {"time":stamp,"category":category,"message":message,"severity":severity})
    del events[60:]
    with connect() as con:
        con.execute("INSERT INTO events(timestamp,category,message,severity) VALUES(?,?,?,?)",
                    (datetime.now().isoformat(timespec="seconds"), category, message, severity))
        con.commit()

def risk_score(d):
    score = d["bandwidth"] * .42 + min(d["latency"],150)/150*25 + min(d["loss"],10)/10*25
    if d["status"] != "Online": score = max(score, 92)
    return max(0, min(100, round(score)))

def active_faults():
    result=[]
    for d in DEVICES:
        if d["status"] != "Online":
            result.append({"id":"FLT-"+d["id"],"device":d["name"],"device_id":d["id"],"type":"Device unavailable",
                           "severity":"Critical","status":"Open","cause":"Device is not responding in the simulation.",
                           "action":"Check upstream connectivity, then run simulated recovery."})
        elif d["bandwidth"] >= 86 or d["latency"] >= 80 or d["loss"] >= 3:
            result.append({"id":"FLT-"+d["id"],"device":d["name"],"device_id":d["id"],
                           "type":"Network congestion / degradation","severity":"High" if d["bandwidth"]<95 else "Critical",
                           "status":"Open","cause":"Threshold-based monitoring detected abnormal metrics.",
                           "action":"Review traffic distribution and consider an alternate path."})
    return result

@app.route("/")
def home():
    return render_template("index.html")

@app.get("/api/state")
def state():
    with lock:
        fs=active_faults()
        avg=round(sum(d["bandwidth"] for d in DEVICES)/len(DEVICES))
        risks=[risk_score(d) for d in DEVICES]
        depts={}
        for d in DEVICES:
            if d["department"] not in ("Infrastructure",):
                depts.setdefault(d["department"],[]).append(d["bandwidth"])
        heat=[{"name":k,"load":round(sum(v)/len(v))} for k,v in depts.items()]
        return jsonify({"devices":DEVICES,"faults":fs,"events":events[:12],"running":simulation_running,
                        "avg_load":avg,"online":sum(d["status"]=="Online" for d in DEVICES),
                        "risk":round(sum(risks)/len(risks)),"heatmap":heat,
                        "scenario":scenario_state,"updated":datetime.now().strftime("%H:%M:%S")})

@app.post("/api/simulation/<action>")
def simulation(action):
    global simulation_running
    if action not in ("start","stop","reset"): return jsonify(error="Unknown action"),400
    with lock:
        if action=="start":
            simulation_running=True; log_event("Simulation","Campus network simulation started.")
        elif action=="stop":
            simulation_running=False; log_event("Simulation","Campus network simulation paused.","warning")
        else:
            simulation_running=False
            for d in DEVICES:
                d.update(status="Online", bandwidth=random.randint(25,58), latency=random.randint(5,24), loss=round(random.uniform(.1,.5),1))
            faults.clear()
            log_event("Simulation","Network simulation reset to healthy baseline.","success")
    return jsonify(ok=True)

@app.post("/api/fault/inject")
def inject_fault():
    with lock:
        target=request.json.get("device_id","SW-01")
        d=next((x for x in DEVICES if x["id"]==target),None)
        if not d: return jsonify(error="Device not found"),404
        d["status"]="Offline"; d["latency"]=150; d["loss"]=8
        log_event("Fault Injection",f'{d["name"]} was marked offline. Downstream impact analysis updated.',"critical")
        return jsonify(ok=True)

@app.post("/api/recover")
def recover():
    target=request.json.get("device_id")
    with lock:
        d=next((x for x in DEVICES if x["id"]==target),None)
        if not d: return jsonify(error="Device not found"),404
        d.update(status="Online",bandwidth=min(d["bandwidth"],68),latency=random.randint(6,22),loss=.2)
        action="Simulated device restart and connectivity verification"
        with connect() as con:
            con.execute("INSERT INTO recoveries(timestamp,device_id,action,result) VALUES(?,?,?,?)",
                        (datetime.now().isoformat(timespec="seconds"),target,action,"Recovered"))
            con.commit()
        log_event("Recovery",f'{d["name"]} restored by recovery simulator.',"success")
        return jsonify(ok=True)

@app.post("/api/scenario")
def scenario():
    global scenario_state
    name=request.json.get("name","Core router failure")
    with lock:
        if name=="Core router failure":
            impacted=[d["name"] for d in DEVICES if d["parent"]=="RTR-01" or d["id"]=="RTR-01"]
            result=f"Potentially impacts {len(impacted)} directly connected network segments. Backup gateway path should be validated."
        elif name=="Traffic increases by 50%":
            impacted=[d["name"] for d in DEVICES if d["bandwidth"]*1.5>=86]
            result=f"{len(impacted)} devices may cross the high-load threshold. Consider load balancing."
        elif name=="New computer lab added":
            impacted=["New Computer Lab","Distribution Switch A"]
            result="Capacity review recommended. Add a lab segment and verify switch uplink headroom."
        elif name=="Backup path unavailable":
            impacted=["Core Router","Core Switch A","Core Switch B"]
            result="Resilience is reduced. A primary-path failure may cause service interruption."
        else:
            impacted=["College ERP Server","Learning Server"]
            result="Academic services may be unavailable. Validate backup server and failover readiness."
        scenario_state={"last":name,"result":result,"impacted":impacted}
        log_event("What-if analysis",f"Scenario tested: {name}. {result}","warning")
        return jsonify(ok=True,scenario=scenario_state)

@app.post("/api/balance")
def balance():
    with lock:
        before=round(sum(d["bandwidth"] for d in DEVICES)/len(DEVICES))
        heavy=max(DEVICES,key=lambda d:d["bandwidth"])
        light=min(DEVICES,key=lambda d:d["bandwidth"])
        moved=min(18,max(0,heavy["bandwidth"]-light["bandwidth"])//3)
        heavy["bandwidth"]=max(10,heavy["bandwidth"]-moved)
        light["bandwidth"]=min(95,light["bandwidth"]+moved)
        log_event("Load balancing",f"Simulated redistribution: {moved}% from {heavy['name']} to {light['name']}.","success")
        return jsonify(ok=True,before=before,from_device=heavy["name"],to_device=light["name"],moved=moved)

@app.post("/api/failover")
def failover():
    with lock:
        log_event("Smart failover","Backup path selected in simulation; no physical router configuration changed.","success")
        return jsonify(ok=True,message="Backup path activated in simulation. Connectivity is represented as restored.")

@app.post("/api/priority")
def priority():
    data=request.json or {}
    service=data.get("service","Online Examinations")
    log_event("Priority allocation",f"Reserved simulated priority bandwidth for {service}.","success")
    return jsonify(ok=True,message=f"Priority allocation simulated for {service}.")

@app.get("/api/report.csv")
def report():
    from flask import Response
    rows=["device_id,device,department,status,bandwidth_percent,latency_ms,packet_loss_percent"]
    for d in DEVICES:
        rows.append(f'{d["id"]},"{d["name"]}",{d["department"]},{d["status"]},{d["bandwidth"]},{d["latency"]},{d["loss"]}')
    return Response("\n".join(rows),mimetype="text/csv",headers={"Content-Disposition":"attachment; filename=netguard-report.csv"})

@app.get("/api/history")
def history():
    with connect() as con:
        rows=con.execute("SELECT timestamp,category,message,severity FROM events ORDER BY id DESC LIMIT 50").fetchall()
        rec=con.execute("SELECT timestamp,device_id,action,result FROM recoveries ORDER BY id DESC LIMIT 20").fetchall()
    return jsonify(events=[dict(x) for x in rows],recoveries=[dict(x) for x in rec])

@app.post("/api/sim-tick")
def sim_tick():
    with lock:
        if simulation_running:
            for d in DEVICES:
                if d["status"]=="Online":
                    d["bandwidth"]=max(8,min(100,d["bandwidth"]+random.randint(-7,9)))
                    d["latency"]=max(4,min(140,d["latency"]+random.randint(-4,7)))
                    d["loss"]=round(max(0,min(8,d["loss"]+random.uniform(-.15,.25))),2)
        return jsonify(ok=True)

init_db()
if not events:
    log_event("System","NetGuard initialized with simulated campus network.","success")

if __name__ == "__main__":
    app.run(debug=True, host="127.0.0.1", port=5000)
