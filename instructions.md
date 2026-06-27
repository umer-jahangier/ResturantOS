# Local dev — quick reference

Run from repo root (`D:\GitHub\ResturantOS`).

## Full stack

```powershell
.\scripts\start-dev.ps1              # start all (rebuilds by default)
.\scripts\start-dev.ps1 -SkipBuild   # start without rebuild
.\scripts\start-dev.ps1 -Stop        # stop everything
```

## One service

```powershell
# Restart (stop → build → start)
.\scripts\restart-service.ps1 auth-service
.\scripts\restart-service.ps1 user-service
.\scripts\restart-service.ps1 gateway
.\scripts\restart-service.ps1 frontend

# Restart without rebuild
.\scripts\restart-service.ps1 auth-service -SkipBuild

# Build only (no restart)
.\scripts\restart-service.ps1 auth-service -BuildOnly

# List all service names + ports
.\scripts\restart-service.ps1 -List
```

## Logs

```powershell
Get-Content .dev-logs\auth-service.log -Tail 50 -Wait
```
