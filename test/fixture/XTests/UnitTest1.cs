namespace XTests;

public class UnitTest1
{
    [Fact]
    public void Passes()
    {
        var answer = 6 * 7;
        Assert.Equal(42, answer); // e2e: breakpoint
    }

    [Fact]
    public void Fails() => Assert.Equal(1, 2);

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    public void Theory(int x) => Assert.True(x > 0);

    public class Nested
    {
        [Fact(Skip = "later")]
        public void Skipped() { }
    }
}
