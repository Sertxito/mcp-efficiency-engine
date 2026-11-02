targetScope = 'resourceGroup'

param location string
param accountName string

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: accountName
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    supportsHttpsTrafficOnly: false
    minimumTlsVersion: 'TLS1_0'
    allowBlobPublicAccess: true
    networkAcls: {
      bypass: 'None'
      defaultAction: 'Allow'
    }
  }
}

output storageId string = storage.name
