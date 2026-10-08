namespace NTests
{
    public class Tests
    {
        [Test]
        public void Passes() => Assert.Pass();

        [TestCase(1)]
        [TestCase(2)]
        public void Cases(int x) => Assert.That(x, Is.EqualTo(1));
    }
}
