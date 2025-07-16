// Test Logger import from @onebun/logger
try {
  console.log('Testing @onebun/logger import...');
  const logger = require('@onebun/logger');
  console.log('Logger package exports:', Object.keys(logger));
} catch (error) {
  console.error('Error importing @onebun/logger:', error.message);
}
  
// Test core import
try {
  console.log('\nTesting @onebun/core import...');
  const core = require('@onebun/core');
  console.log('Core package exports:', Object.keys(core));
} catch (error) {
  console.error('Error importing @onebun/core:', error.message);
} 
