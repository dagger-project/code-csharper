var greeting = Environment.GetEnvironmentVariable("GREETING") ?? "Hello";
var name = args.Length > 0 ? args[0] : "world";
var message = $"{greeting}, {name}!";
Console.WriteLine(message); // e2e: breakpoint
Console.WriteLine($"cwd={Environment.CurrentDirectory}");
