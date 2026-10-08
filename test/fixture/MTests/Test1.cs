namespace MTests;

[TestClass]
public sealed class Test1
{
    [TestMethod]
    public void Passes() { }

    [TestMethod]
    [DataRow(1)]
    [DataRow(2)]
    public void Rows(int x) => Assert.AreEqual(1, x);
}
