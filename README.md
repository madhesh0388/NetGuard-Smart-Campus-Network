# NetGuard – Smart Campus Network Load & Fault Management System

A Flask + SQLite hackathon prototype for campus network monitoring, load management and fault-management demonstrations.

## Features
- Campus command-center dashboard
- Interactive simulated network digital twin
- Department congestion heatmap
- Bandwidth monitoring and load-balancing simulation
- Rule-based early-warning risk scores
- Fault injection and probable root-cause analysis
- Simulated recovery and backup-path failover
- Priority-based traffic allocation demonstration
- Incident timeline and recovery history
- What-if scenario simulator
- CSV device report export

## Run on Windows

1. Extract the ZIP.
2. Open the `NetGuard` folder in VS Code.
3. Open Terminal > New Terminal.
4. Run:

```powershell
py -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
py app.py
```

5. Open http://127.0.0.1:5000

## Important
This project uses simulated campus network metrics. It does not monitor or configure real routers, switches, access points or servers. The failover, recovery, traffic allocation and balancing controls are demonstrations only.
