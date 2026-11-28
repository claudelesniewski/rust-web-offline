// Starter programs, offered in the Examples menu. Each becomes a new file.

/** A Jupyter notebook's text, of `cells`: [type, source]. */
function notebook(cells) {
  return `${JSON.stringify({
    cells: cells.map(([type, source], i) => ({
      cell_type: type, id: `cell${i + 1}`, metadata: {}, source: source.split(/(?<=\n)/),
      ...(type === "code" ? { execution_count: null, outputs: [] } : {}),
    })),
    metadata: { kernelspec: { display_name: "Python 3", language: "python", name: "python3" } },
    nbformat: 4,
    nbformat_minor: 5,
  }, null, 1)}\n`;
}

export const EXAMPLES = {
  "hello.rs": `fn main() {
    println!("Hello, world!");
}
`,
  "shapes.rs": `// Vec, String, and a struct with impl blocks.
use std::fmt;

#[derive(Debug, Clone)]
struct Rect {
    name: String,
    width: f64,
    height: f64,
}

impl Rect {
    fn new(name: &str, width: f64, height: f64) -> Self {
        Rect { name: name.to_string(), width, height }
    }

    fn area(&self) -> f64 {
        self.width * self.height
    }

    fn scale(&mut self, factor: f64) {
        self.width *= factor;
        self.height *= factor;
    }
}

impl fmt::Display for Rect {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{} ({} x {})", self.name, self.width, self.height)
    }
}

fn main() {
    let mut rects: Vec<Rect> = vec![
        Rect::new("door", 1.0, 2.0),
        Rect::new("window", 1.5, 1.2),
    ];
    rects.push(Rect::new("table", 2.0, 1.0));
    rects[0].scale(2.0);

    let mut report = String::new();
    for r in &rects {
        report.push_str(&format!("{r}: area {:.2}\\n", r.area()));
    }
    print!("{report}");

    let total: f64 = rects.iter().map(Rect::area).sum();
    println!("total area: {total:.2}");
}
`,
  "stdin.rs": `// Reads lines from stdin until EOF (Ctrl-D in the input line).
use std::io::{self, BufRead, Write};

fn main() {
    print!("What's your name? ");
    io::stdout().flush().unwrap();
    let mut name = String::new();
    io::stdin().read_line(&mut name).unwrap();
    println!("Hello, {}!", name.trim());

    println!("Enter numbers, one per line (Ctrl-D to finish):");
    let mut sum = 0i64;
    for line in io::stdin().lock().lines() {
        match line.unwrap().trim().parse::<i64>() {
            Ok(n) => sum += n,
            Err(e) => println!("  skipped: {e}"),
        }
    }
    println!("sum = {sum}");
}
`,
  "threads.rs": `use std::sync::mpsc;
use std::thread;

fn main() {
    let (tx, rx) = mpsc::channel();
    for id in 0..4 {
        let tx = tx.clone();
        thread::spawn(move || {
            let sum: u64 = (0..1_000_000u64).filter(|n| n % (id + 2) == 0).sum();
            tx.send((id, sum)).unwrap();
        });
    }
    drop(tx);
    let mut results: Vec<_> = rx.iter().collect();
    results.sort();
    for (id, sum) in results {
        println!("thread {id}: {sum}");
    }
}
`,
  "hello.py": `# Python, from the Python pack: installed the first time you run it.
name = input("What's your name? ")
squares = [n * n for n in range(1, 6)]
print(f"Hello, {name}! Squares: {squares}, sum {sum(squares)}")
`,
  "notebook.ipynb": notebook([
    ["markdown", "# A notebook\n\nIts cells run in one Python session, the *kernel*: what one defines, the next can use. "
      + "**Shift-Enter** runs a cell and moves on; double-click this text to edit it."],
    ["code", 'print("Hello from a notebook!")\nx = 2'],
    ["code", "# A cell's last expression is its result.\nx * 21"],
    ["code", 'name = input("What\'s your name? ")\nf"Hello, {name}!"'],
  ]),
  "modules.rs": `// Other files are modules: \`mod geometry;\` uses geometry.rs.
// Create a file named geometry.rs containing:
//     pub fn double(x: i32) -> i32 { x * 2 }
// then uncomment the lines below.

// mod geometry;

fn main() {
    // println!("{}", geometry::double(21));
    println!("See the comments at the top of this file.");
}
`,
};
