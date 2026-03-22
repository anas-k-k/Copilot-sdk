import { execSync } from 'child_process';
import { existsSync } from 'fs';

const cwd = 'C:\\Projects\\AI\\Copilot-sdk';

console.log('Starting npm install...');
try {
  execSync('npm install', { cwd, stdio: 'inherit', shell: true });
  console.log('\n✓ npm install completed successfully');
} catch (e) {
  console.error('\n✗ npm install failed');
  process.exit(1);
}

console.log('\nStarting npm run build...');
try {
  execSync('npm run build', { cwd, stdio: 'inherit', shell: true });
  console.log('\n✓ npm run build completed successfully');
} catch (e) {
  console.error('\n✗ npm run build failed');
  process.exit(1);
}

console.log('\nStarting npm run test...');
try {
  execSync('npm run test', { cwd, stdio: 'inherit', shell: true });
  console.log('\n✓ npm run test completed successfully');
} catch (e) {
  console.error('\n✗ npm run test failed');
  process.exit(1);
}

console.log('\n✓ All tasks completed successfully!');
