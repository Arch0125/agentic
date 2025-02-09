import { SecretVaultWrapper } from 'nillion-sv-wrappers';
import { orgConfig } from './nillionOrgConfig.js';

const SCHEMA_ID = '659fa7d3-e071-45a6-ae0d-2b38fadf96f7';

// const data = [
//   {
//     timestamp: { $allot: '2025-02-09T12:34:56Z' },
//     data: { $allot: 'Example data string 1' }
//   },
//   {
//     timestamp: { $allot: '2025-02-09T12:35:56Z' },
//     data: { $allot: 'Example data string 2' }
//   },
// ];

export async function submitToNillion(data:{ timestamp: string; data: string; }[]) {

  const formattedData = data.map((item) => {
    return {
      timestamp: { $allot: item.timestamp },
      data: { $allot: item.data },
    };
  });

  try {
    const collection = new SecretVaultWrapper(
      orgConfig.nodes,
      orgConfig.orgCredentials,
      SCHEMA_ID
    );
    await collection.init();

    const dataWritten = await collection.writeToNodes(formattedData);
    console.log(
      '👀 Data written to nodes:',
      JSON.stringify(dataWritten, null, 2)
    );

    const newIds = [
      ...new Set(dataWritten.map((item) => item.result.data.created).flat()),
    ];
    console.log('Uploaded record ids:', newIds);
  } catch (error) {
    console.error('❌ SecretVaultWrapper error:', error.message);
    process.exit(1);
  }
}
