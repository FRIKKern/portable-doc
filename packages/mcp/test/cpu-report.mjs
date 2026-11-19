// Loaded with `--import` into the server by tests that hold it to a CPU budget: after
// each write to stdout (each reply), the server writes its CPU time so far to stderr,
// as `cpu-us <user + system microseconds>`. The parent's process.cpuUsage cannot see a
// child's CPU, and a child's wall time measures the machine's load.
const write = process.stdout.write.bind(process.stdout);
process.stdout.write = (...args) => {
  const written = write(...args);
  const { user, system } = process.cpuUsage();
  process.stderr.write(`cpu-us ${user + system}\n`);
  return written;
};
