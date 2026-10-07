// The optional native parts of `ssh2` (`cpu-features`, and `nan` for its crypto binding) are refused (4.1.9, D19,
// docs/dev/threat-models/ssh.md): the root package.json `overrides` maps both here, so `npm ci` builds no native
// code and `ssh2` runs on its pure JavaScript paths. Calling this module is the explicit refusal.
module.exports = () => {
  throw new Error('web-scumm-connectors refuses native code (cpu-features, nan): ssh2 runs in pure JavaScript');
};
