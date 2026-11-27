import assert from "node:assert/strict";
import { test } from "node:test";
import { withDependencies } from "../../web/packs.js";

// As in a Pyodide lock file.
const packages = {
  pandas: { file_name: "pandas.whl", sha256: "p", depends: ["numpy", "python-dateutil"] },
  numpy: { file_name: "numpy.whl", sha256: "n", depends: [] },
  "python-dateutil": { file_name: "dateutil.whl", sha256: "d", depends: ["six"] },
  six: { file_name: "six.whl", sha256: "s" },
};

test("packages come with what they depend on, dependencies first, once each", () => {
  assert.deepEqual(withDependencies(packages, ["pandas", "numpy"]).map((p) => p.name),
    ["numpy", "six", "python-dateutil", "pandas"]);
  assert.deepEqual(withDependencies(packages, ["six"]), [{ name: "six", file_name: "six.whl", sha256: "s" }]);
});

test("package names are matched as pip does: any case, _ or . for -", () => {
  assert.deepEqual(withDependencies(packages, ["Python_DateUtil"]).map((p) => p.name), ["six", "python-dateutil"]);
});

test("an unknown package is an error", () => {
  assert.throws(() => withDependencies(packages, ["torch"]), /no package named torch/);
});
