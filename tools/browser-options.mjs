// Exercise the GPU renderer in Windows headless checks, as in the visible demo.
// Software rendering is useful for compatibility checks, but distorts timing
// and can exceed the routine's wall-clock test timeout.
export const browserOptions = {
  headless: true,
  args: ['--ignore-certificate-errors', '--enable-gpu', '--ignore-gpu-blocklist',
    ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : [])],
};
