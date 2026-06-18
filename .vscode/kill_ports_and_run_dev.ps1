$matches = netstat -ano | Select-String ':3000|:3001|:3002|:24678'
$pids = $matches | ForEach-Object { ($_ -split '\s+')[-1] } | Select-Object -Unique
if ($pids -and $pids.Count -gt 0) {
  foreach ($pid in $pids) {
    Write-Output "Killing PID $pid"
    taskkill /PID $pid /F | Out-Null
  }
} else {
  Write-Output 'No PIDs found'
}
# Start dev server
npm run dev
