param(
    [string]$SourceConnectionString = 'Server=(localdb)\MSSQLLocalDB;Database=TechRidersDev;Trusted_Connection=True;MultipleActiveResultSets=True;TrustServerCertificate=True',
    [string]$TargetServer = 'sql-techriders-dev-ohbnpr4l4fihc.database.windows.net',
    [string]$TargetDatabase = 'sqldb-techriders-dev',
    [string]$TargetUser = 'sqladminuser'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Data

if ([string]::IsNullOrWhiteSpace($env:SQL_ADMIN_PASSWORD)) {
    throw 'Missing SQL_ADMIN_PASSWORD environment variable.'
}

$targetConnectionString = "Server=tcp:$TargetServer,1433;Initial Catalog=$TargetDatabase;Persist Security Info=False;User ID=$TargetUser;Password=$($env:SQL_ADMIN_PASSWORD);MultipleActiveResultSets=True;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;"

$sourceConn = New-Object System.Data.SqlClient.SqlConnection $SourceConnectionString
$targetConn = New-Object System.Data.SqlClient.SqlConnection $targetConnectionString

try {
    $sourceConn.Open()
    $targetConn.Open()

    $tableCmd = $sourceConn.CreateCommand()
    $tableCmd.CommandText = @"
SELECT s.name AS SchemaName, t.name AS TableName
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
WHERE t.is_ms_shipped = 0
ORDER BY s.name, t.name;
"@

    $reader = $tableCmd.ExecuteReader()
    $tables = New-Object System.Collections.Generic.List[object]
    while ($reader.Read()) {
        $schema = $reader.GetString(0)
        $table = $reader.GetString(1)
        if ($table -ne '__EFMigrationsHistory') {
            $tables.Add([PSCustomObject]@{ Schema = $schema; Table = $table })
        }
    }
    $reader.Close()

    if ($tables.Count -eq 0) {
        throw 'No source user tables found.'
    }

    foreach ($t in $tables) {
        $fullName = "[$($t.Schema)].[$($t.Table)]"
        $disableCmd = $targetConn.CreateCommand()
        $disableCmd.CommandText = "ALTER TABLE $fullName NOCHECK CONSTRAINT ALL;"
        [void]$disableCmd.ExecuteNonQuery()
    }

    $summary = New-Object System.Collections.Generic.List[object]

    foreach ($t in $tables) {
        $fullName = "[$($t.Schema)].[$($t.Table)]"

        $deleteCmd = $targetConn.CreateCommand()
        $deleteCmd.CommandText = "DELETE FROM $fullName;"
        [void]$deleteCmd.ExecuteNonQuery()

        $selectCmd = $sourceConn.CreateCommand()
        $selectCmd.CommandText = "SELECT * FROM $fullName;"

        $adapter = New-Object System.Data.SqlClient.SqlDataAdapter $selectCmd
        $dataTable = New-Object System.Data.DataTable
        [void]$adapter.Fill($dataTable)

        if ($dataTable.Rows.Count -gt 0) {
            $bulkCopy = New-Object System.Data.SqlClient.SqlBulkCopy($targetConn, [System.Data.SqlClient.SqlBulkCopyOptions]::KeepIdentity, $null)
            $bulkCopy.DestinationTableName = $fullName
            $bulkCopy.BulkCopyTimeout = 0
            foreach ($col in $dataTable.Columns) {
                [void]$bulkCopy.ColumnMappings.Add($col.ColumnName, $col.ColumnName)
            }
            $bulkCopy.WriteToServer($dataTable)
            $bulkCopy.Close()
        }

        $summary.Add([PSCustomObject]@{ Table = $fullName; Rows = $dataTable.Rows.Count })
    }

    foreach ($t in $tables) {
        $fullName = "[$($t.Schema)].[$($t.Table)]"
        $enableCmd = $targetConn.CreateCommand()
        $enableCmd.CommandText = "ALTER TABLE $fullName WITH CHECK CHECK CONSTRAINT ALL;"
        [void]$enableCmd.ExecuteNonQuery()
    }

    $summary | Sort-Object Table | Format-Table -AutoSize | Out-String | Write-Output
    Write-Output 'MIGRATION_COMPLETED'
}
finally {
    if ($sourceConn.State -eq 'Open') { $sourceConn.Close() }
    if ($targetConn.State -eq 'Open') { $targetConn.Close() }
}
